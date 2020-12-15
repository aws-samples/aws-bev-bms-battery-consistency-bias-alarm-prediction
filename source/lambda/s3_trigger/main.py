import boto3
import json
import os
import uuid

sm_runtime = boto3.client('runtime.sagemaker')
dynamodb = boto3.client('dynamodb')
s3 = boto3.client('s3')


def handler(event, context):
    # Step 1: parse environment parameters
    infer_bucket_name = os.environ['INFER_BUCKET_NAME']
    ddb_table_name = os.environ['DYNAMODB_TABLE_NAME']
    ddb_primary_key = os.environ['DYNAMODB_PRIMARY_KEY']
    endpoint_name = os.environ['SAGEMAKER_ENDPOINT_NAME']
    save_bucket_name = os.environ['DUMP_BUCKET_NAME']
    save_bucket_prefix = os.environ['DUMP_BUCKET_PREFIX']

    # Step 2: obtain all records in csv file
    csv_file_name = event['Records'][0]['s3']['object']['key']
    tmp_path = '/tmp/{}'.format(csv_file_name)
    print('[Start] download {} to {}'.format(csv_file_name, tmp_path))
    with open(tmp_path, 'wb') as wf:
        s3.download_fileobj(infer_bucket_name, csv_file_name, wf)
    print('[Complete] download {} to {}'.format(csv_file_name, tmp_path))

    with open(tmp_path, 'rb') as rf:
        all_test_samples = rf.readlines()

    # Step 3: invoke Sagemaker endpoint to perform forward inference
    for index, sample in enumerate(all_test_samples):
        sample = sample.strip()
        sample = sample.decode()

        # extract VIN code, date and features from each record
        vin = sample.split(',')[0]
        date = sample.split(',')[1]
        features = sample.split('{},'.format(date))[1]
        feat_components = features.split(',')
        assert len(feat_components) == 84

        # invoke Sagemaker runtime endpoint to infer the probability
        response = sm_runtime.invoke_endpoint(
            EndpointName=endpoint_name,
            ContentType='text/csv',
            Body=features.encode(),
        )
        pred_prob = float(response['Body'].read().decode())
        print('Index = {} / {}: predicted_prob = {}'.format(index+1, len(all_test_samples), pred_prob))

        # Step 4: Store the result (inference event) into DynamoDB
        request_id = str(uuid.uuid4())
        insert_item = {
            ddb_primary_key: {'S': request_id},
            'vin': {'S': vin},
            'date': {'S': date},
            'predicted_prob': {'N': str(pred_prob)},
        }
        for day_index in range(0, 14):
            insert_item['total_voltage_{}'.format(14 - day_index)] = {'N': feat_components[day_index * 6 + 0]}
            insert_item['total_current_{}'.format(14 - day_index)] = {'N': feat_components[day_index * 6 + 1]}
            insert_item['cell_max_voltage_{}'.format(14 - day_index)] = {'N': feat_components[day_index * 6 + 2]}
            insert_item['cell_min_voltage_{}'.format(14 - day_index)] = {'N': feat_components[day_index * 6 + 3]}
            insert_item['max_temperature_{}'.format(14 - day_index)] = {'N': feat_components[day_index * 6 + 4]}
            insert_item['min_temperature_{}'.format(14 - day_index)] = {'N': feat_components[day_index * 6 + 5]}

        dynamodb.put_item(
            TableName=ddb_table_name,
            Item=insert_item
        )

        # Step 5: save inference event into S3 bucket for superset visualization
        s3_insert_event = {
            ddb_primary_key: request_id,
            'vin': vin,
            'date': date,
            'predicted_prob': pred_prob,
        }
        for day_index in range(0, 14):
            s3_insert_event['total_voltage_{}'.format(14 - day_index)] = float(feat_components[day_index * 6 + 0])
            s3_insert_event['total_current_{}'.format(14 - day_index)] = float(feat_components[day_index * 6 + 1])
            s3_insert_event['cell_max_voltage_{}'.format(14 - day_index)] = float(feat_components[day_index * 6 + 2])
            s3_insert_event['cell_min_voltage_{}'.format(14 - day_index)] = float(feat_components[day_index * 6 + 3])
            s3_insert_event['max_temperature_{}'.format(14 - day_index)] = float(feat_components[day_index * 6 + 4])
            s3_insert_event['min_temperature_{}'.format(14 - day_index)] = float(feat_components[day_index * 6 + 5])

        serialized_data = json.dumps(s3_insert_event, separators=(',', ':'))
        s3_dump_response = s3.put_object(
            Bucket=save_bucket_name,
            Key=os.path.join(save_bucket_prefix, request_id + '.json'),
            Body=serialized_data)

    # Step 6: return response
    response = {
        'statusCode': 200,
        'body': 'success'
    }
    return response

