import boto3
import os
import uuid
import json

sm_runtime = boto3.client('runtime.sagemaker')
dynamodb = boto3.client('dynamodb')
s3 = boto3.client('s3')


def handler(event, context):
    # Step 1: parse environment parameters
    ddb_table_name = os.environ['DYNAMODB_TABLE_NAME']
    ddb_primary_key = os.environ['DYNAMODB_PRIMARY_KEY']
    endpoint_name = os.environ['SAGEMAKER_ENDPOINT_NAME']
    save_bucket_name = os.environ['DUMP_BUCKET_NAME']
    save_bucket_prefix = os.environ['DUMP_BUCKET_PREFIX']

    # Step 2: obtain request body
    request_body = event['body']
    request_body = json.loads(request_body)
    vin = request_body.get('vin')
    date = request_body.get('date')
    features = request_body.get('features')
    feat_components = features.split(',')
    assert len(feat_components) == 84

    # Step 3: invoke Sagemaker endpoint to predict
    response = sm_runtime.invoke_endpoint(
        EndpointName=endpoint_name,
        ContentType='text/csv',
        Body=features,
    )
    pred_prob = float(response['Body'].read().decode())

    # Step 4: store the result into DynamoDB table
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

    # Step 5: store inference results to S3 for superset visualization
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
        'body': pred_prob,
        "headers":
            {
                "Content-Type": "application/json",
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
            }
    }
    return response

