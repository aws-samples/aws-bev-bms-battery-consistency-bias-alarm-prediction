import * as cdk from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3'
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import * as lambda from '@aws-cdk/aws-lambda';
import * as agw from '@aws-cdk/aws-apigateway'
import * as ecr from '@aws-cdk/aws-ecr';
import * as sagemaker from '@aws-cdk/aws-sagemaker'
import * as iam from '@aws-cdk/aws-iam'
import * as ec2 from '@aws-cdk/aws-ec2'
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecs_patterns from "@aws-cdk/aws-ecs-patterns";
import * as glue from "@aws-cdk/aws-glue"
import * as lambda_event from "@aws-cdk/aws-lambda-event-sources";
import fs = require('fs')


export class AwsBevBmsBatteryConsistencyBiasAlarmPredictionStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /**
    * Get Parameters
    */
    const sagemakerEndpointName = new cdk.CfnParameter(this, 'sagemakerEndpointName', {
        description: 'Sagemaker Runtime Endpoint Name',
        type: 'String',
        default: 'battery-consistency-bias-alarm-prediction-endpoint'
    });

    /**
    * S3 buckets provision:
    * 1). BevBmsBatteryConsistencyBiasAlarmPredictionTrainS3: store train dataset for battery cell fault prediction
    * 2). BevBmsBatteryConsistencyBiasAlarmPredictionInferS3: when new batch data are uploaded, it invokes lambda to predict automatically
    * 3). BevBmsBatteryConsistencyBiasAlarmPredictionEventsS3: store all prediction events for further query and visualization
    */
    const bevBmsBatteryConsistencyBiasAlarmPredictionTrainS3 = new s3.Bucket(
        this,
        'bevBmsBatteryConsistencyBiasAlarmPredictionTrainS3',
        {
            bucketName: `bev-bms-train-${this.region}-${this.account}`,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        }
    );

    const bevBmsBatteryConsistencyBiasAlarmPredictionInferS3 = new s3.Bucket(
        this,
        'bevBmsBatteryConsistencyBiasAlarmPredictionInferS3',
        {
            bucketName: `bev-bms-infer-${this.region}-${this.account}`,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        }
    );

    const bevBmsBatteryConsistencyBiasAlarmPredictionEventsS3 = new s3.Bucket(
        this,
        'bevBmsBatteryConsistencyBiasAlarmPredictionEventsS3',
        {
            bucketName: `bev-bms-events-${this.region}-${this.account}`,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        }
    );


    /**
    * Provision ECS fargate service to host superset to visualize prediction events
    */
    const supersetVpc = new ec2.Vpc(this, 'supersetVpc', { maxAzs: 3 });
    const supersetCluster = new ecs.Cluster(this,'supersetCluster', {vpc: supersetVpc});

    new cdk.CfnCondition(this, 'IsChinaRegionCondition', {
        expression: cdk.Fn.conditionEquals(cdk.Aws.PARTITION, 'aws-cn')
    });

    const supersetEcrRepoName = 'battery-consistency-bias-alarm-prediction-visualization';
    const supersetEcrRepoArn = cdk.Fn.conditionIf('IsChinaRegionCondition',
        'arn:aws-cn:ecr:cn-northwest-1:753680513547:repository/battery-consistency-bias-alarm-prediction-visualization',
        'arn:aws:ecr:us-west-2:366590864501:repository/battery-consistency-bias-alarm-prediction-visualization')

    const supersetEcrRepo = ecr.Repository.fromRepositoryAttributes(this, 'supersetEcrRepo', {
        repositoryName: supersetEcrRepoName, repositoryArn: supersetEcrRepoArn.toString() });

    const supersetFargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        'supersetFargateService',
        {
            serviceName: 'battery-consistency-bias-alarm-prediction-superset-host',
            cluster: supersetCluster,
            cpu: 1024,
            desiredCount: 1,
            assignPublicIp: true,
            memoryLimitMiB: 4096,
            taskImageOptions: {
                image: ecs.ContainerImage.fromEcrRepository(supersetEcrRepo),
            },
        }
    );

    // change the healthy check path
    supersetFargateService.targetGroup.configureHealthCheck({ path: "/login/" });
    // add permission for Glue and Athena
    supersetFargateService.taskDefinition.taskRole.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonAthenaFullAccess"));
    supersetFargateService.taskDefinition.taskRole.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"));


    /**
     * Create DynamoDB table: when forward inference is performed, all the results are stored
     * in dynamodb table, which will be retrieved for front-end visualization
     */
    const bevBmsBatteryConsistencyBiasAlarmPredictionEventsDdbTable = new dynamodb.Table(
        this,
        'bevBmsBatteryConsistencyBiasAlarmPredictionEventsDdbTable',
        {
            partitionKey: {
                name: 'request_id',
                type: dynamodb.AttributeType.STRING
            },
            tableName: 'battery-consistency-bias-alarm-prediction-events-ddb',
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        }
    );


    /**
     * Create lambda functions:
     * 1. S3 trigger prediction: forward inference is triggered when user upload batch data into batteryCellFaultInferS3
     * 2. API trigger prediction: forward inference is triggered when user invoke prediction API
     */
    const accessPolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
            "sagemaker:InvokeEndpoint",
            "s3:GetObject",
            "s3:PutObject",
        ],
        resources: [
            "*"
        ]
    });
    accessPolicy.addAllResources();

    const bevBmsBatteryConsistencyBiasAlarmPredictionS3Trigger = new lambda.Function(
        this,
        'bevBmsBatteryConsistencyBiasAlarmPredictionS3Trigger',
        {
            functionName: 'battery-consistency-bias-alarm-prediction-s3-trigger',
            code: new lambda.AssetCode('./lambda/s3_trigger/'),
            handler: 'main.handler',
            runtime: lambda.Runtime.PYTHON_3_8,
            environment: {
                INFER_BUCKET_NAME: bevBmsBatteryConsistencyBiasAlarmPredictionInferS3.bucketName,
                DUMP_BUCKET_NAME: bevBmsBatteryConsistencyBiasAlarmPredictionEventsS3.bucketName,
                DUMP_BUCKET_PREFIX: 'events',
                DYNAMODB_TABLE_NAME: bevBmsBatteryConsistencyBiasAlarmPredictionEventsDdbTable.tableName,
                DYNAMODB_PRIMARY_KEY: 'request_id',
                SAGEMAKER_ENDPOINT_NAME: sagemakerEndpointName.valueAsString
            },
            memorySize: 1024,
            timeout: cdk.Duration.minutes(15),
        }
    );
    bevBmsBatteryConsistencyBiasAlarmPredictionS3Trigger.addToRolePolicy(accessPolicy);

    bevBmsBatteryConsistencyBiasAlarmPredictionS3Trigger.addEventSource(new lambda_event.S3EventSource(
        bevBmsBatteryConsistencyBiasAlarmPredictionInferS3,
        {
            events: [
                s3.EventType.OBJECT_CREATED,
            ],
            filters: [{suffix: '.csv'}]
        }
    ));

    const bevBmsBatteryConsistencyBiasAlarmPredictionApiTrigger = new lambda.Function(
        this,
        'bevBmsBatteryConsistencyBiasAlarmPredictionApiTrigger',
        {
            functionName: 'battery-consistency-bias-alarm-prediction-api-trigger',
            code: new lambda.AssetCode('./lambda/api_trigger/'),
            handler: 'main.handler',
            runtime: lambda.Runtime.PYTHON_3_8,
            environment: {
                DUMP_BUCKET_NAME: bevBmsBatteryConsistencyBiasAlarmPredictionEventsS3.bucketName,
                DUMP_BUCKET_PREFIX: 'events',
                DYNAMODB_TABLE_NAME: bevBmsBatteryConsistencyBiasAlarmPredictionEventsDdbTable.tableName,
                DYNAMODB_PRIMARY_KEY: 'request_id',
                SAGEMAKER_ENDPOINT_NAME: sagemakerEndpointName.valueAsString
            },
            memorySize: 512,
            timeout: cdk.Duration.seconds(30),
        }
    );
    bevBmsBatteryConsistencyBiasAlarmPredictionApiTrigger.addToRolePolicy(accessPolicy);

    // assign dynamodb permissions for lambda functions
    bevBmsBatteryConsistencyBiasAlarmPredictionEventsDdbTable.grantWriteData(bevBmsBatteryConsistencyBiasAlarmPredictionS3Trigger);
    bevBmsBatteryConsistencyBiasAlarmPredictionEventsDdbTable.grantWriteData(bevBmsBatteryConsistencyBiasAlarmPredictionApiTrigger);


    /**
    *  Create API Gateway, the API route includes:
    *  /inference [POST]   Predict Poor Battery Consistency using API invocation
    */
    const bevBmsBatteryConsistencyBiasAlarmPredictionApiRouter = new agw.RestApi(
        this,
        'bevBmsBatteryConsistencyBiasAlarmPredictionApiRouter',
        {
            restApiName: 'battery-consistency-bias-alarm-prediction-api-router',
            endpointConfiguration: {
                types: [agw.EndpointType.REGIONAL]
            },
            defaultCorsPreflightOptions: {
                allowOrigins: agw.Cors.ALL_ORIGINS,
                allowMethods: agw.Cors.ALL_METHODS
            },
        }
    );

    const inferRoute = bevBmsBatteryConsistencyBiasAlarmPredictionApiRouter.root.addResource('inference');
    inferRoute.addMethod('POST', new agw.LambdaIntegration(bevBmsBatteryConsistencyBiasAlarmPredictionApiTrigger));


    /**
    * Create Sagemaker notebook and download the example script and sample dataset
    */
    const bevBmsBatteryConsistencyBiasAlarmPredictionNotebookRole = new iam.Role(
        this,
        'bevBmsBatteryConsistencyBiasAlarmPredictionNotebookRole',
        {
            roleName: 'battery-consistency-bias-alarm-prediction-notebook-role',
            assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFullAccess'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'),
            ]
        }
    );

    // create the SageMaker notebook lifecycle configuration
    const onCreateScript = fs.readFileSync('./sagemaker/onCreate.sh', 'utf8');
    const bevBmsBatteryConsistencyBiasAlarmPredictionLifecycleConfig = new sagemaker.CfnNotebookInstanceLifecycleConfig(
        this,
        'bevBmsBatteryConsistencyBiasAlarmPredictionLifecycleConfig',
        {
            notebookInstanceLifecycleConfigName: 'battery-consistency-bias-alarm-prediction-lifecycle-conf',
            onCreate: [{content: cdk.Fn.base64(onCreateScript!)}],
        }
    );

    // create the SageMaker notebook instance
    new sagemaker.CfnNotebookInstance(
        this,
        'bevBmsBatteryConsistencyBiasAlarmPredictionNotebookInstance',
        {
            notebookInstanceName: "battery-consistency-bias-alarm-prediction-example",
            lifecycleConfigName: bevBmsBatteryConsistencyBiasAlarmPredictionLifecycleConfig.notebookInstanceLifecycleConfigName,
            roleArn: bevBmsBatteryConsistencyBiasAlarmPredictionNotebookRole.roleArn,
            instanceType: 'ml.t2.medium',
            volumeSizeInGb: 128,
        }
    );


    /**
    * Create Glue database and table for superset query and front-end visualization
    */
    const bevBmsBatteryConsistencyBiasAlarmPredictionGlueDatabase = new glue.Database(
        this,
        'bevBmsBatteryConsistencyBiasAlarmPredictionGlueDatabase',
        {
            databaseName: 'battery-consistency-bias-alarm-prediction-glue-database',
        }
    );

    new glue.Table(
        this,
        'bevBmsBatteryConsistencyBiasAlarmPredictionEventsGlueTable',
        {
            tableName: 'battery-consistency-bias-alarm-prediction-events',
            database: bevBmsBatteryConsistencyBiasAlarmPredictionGlueDatabase,
            bucket: bevBmsBatteryConsistencyBiasAlarmPredictionEventsS3,
            s3Prefix: 'events',
            columns: [
                { name:  "request_id", type: glue.Schema.STRING },
                { name:  "vin", type: glue.Schema.STRING },
                { name:  "date", type: glue.Schema.DATE },
                { name:  "predicted_prob", type: glue.Schema.FLOAT },
                { name:  "total_voltage_14", type: glue.Schema.FLOAT },
                { name:  "total_current_14", type: glue.Schema.FLOAT },
                { name:  "cell_max_voltage_14", type: glue.Schema.FLOAT },
                { name:  "cell_min_voltage_14", type: glue.Schema.FLOAT },
                { name:  "max_temperature_14", type: glue.Schema.FLOAT },
                { name:  "min_temperature_14", type: glue.Schema.FLOAT },
                { name:  "total_voltage_13", type: glue.Schema.FLOAT },
                { name:  "total_current_13", type: glue.Schema.FLOAT },
                { name:  "cell_max_voltage_13", type: glue.Schema.FLOAT },
                { name:  "cell_min_voltage_13", type: glue.Schema.FLOAT },
                { name:  "max_temperature_13", type: glue.Schema.FLOAT },
                { name:  "min_temperature_13", type: glue.Schema.FLOAT },
                { name:  "total_voltage_12", type: glue.Schema.FLOAT },
                { name:  "total_current_12", type: glue.Schema.FLOAT },
                { name:  "cell_max_voltage_12", type: glue.Schema.FLOAT },
                { name:  "cell_min_voltage_12", type: glue.Schema.FLOAT },
                { name:  "max_temperature_12", type: glue.Schema.FLOAT },
                { name:  "min_temperature_12", type: glue.Schema.FLOAT },
                { name:  "total_voltage_11", type: glue.Schema.FLOAT },
                { name:  "total_current_11", type: glue.Schema.FLOAT },
                { name:  "cell_max_voltage_11", type: glue.Schema.FLOAT },
                { name:  "cell_min_voltage_11", type: glue.Schema.FLOAT },
                { name:  "max_temperature_11", type: glue.Schema.FLOAT },
                { name:  "min_temperature_11", type: glue.Schema.FLOAT },
                { name:  "total_voltage_10", type: glue.Schema.FLOAT },
                { name:  "total_current_10", type: glue.Schema.FLOAT },
                { name:  "cell_max_voltage_10", type: glue.Schema.FLOAT },
                { name:  "cell_min_voltage_10", type: glue.Schema.FLOAT },
                { name:  "max_temperature_10", type: glue.Schema.FLOAT },
                { name:  "min_temperature_10", type: glue.Schema.FLOAT },
                { name:  "total_voltage_9", type: glue.Schema.FLOAT },
                { name:  "total_current_9", type: glue.Schema.FLOAT },
                { name:  "cell_max_voltage_9", type: glue.Schema.FLOAT },
                { name:  "cell_min_voltage_9", type: glue.Schema.FLOAT },
                { name:  "max_temperature_9", type: glue.Schema.FLOAT },
                { name:  "min_temperature_9", type: glue.Schema.FLOAT },
                { name:  "total_voltage_8", type: glue.Schema.FLOAT },
                { name:  "total_current_8", type: glue.Schema.FLOAT },
                { name:  "cell_max_voltage_8", type: glue.Schema.FLOAT },
                { name:  "cell_min_voltage_8", type: glue.Schema.FLOAT },
                { name:  "max_temperature_8", type: glue.Schema.FLOAT },
                { name:  "min_temperature_8", type: glue.Schema.FLOAT },
                { name:  "total_voltage_7", type: glue.Schema.FLOAT },
                { name:  "total_current_7", type: glue.Schema.FLOAT },
                { name:  "cell_max_voltage_7", type: glue.Schema.FLOAT },
                { name:  "cell_min_voltage_7", type: glue.Schema.FLOAT },
                { name:  "max_temperature_7", type: glue.Schema.FLOAT },
                { name:  "min_temperature_7", type: glue.Schema.FLOAT },
                { name:  "total_voltage_6", type: glue.Schema.FLOAT },
                { name:  "total_current_6", type: glue.Schema.FLOAT },
                { name:  "cell_max_voltage_6", type: glue.Schema.FLOAT },
                { name:  "cell_min_voltage_6", type: glue.Schema.FLOAT },
                { name:  "max_temperature_6", type: glue.Schema.FLOAT },
                { name:  "min_temperature_6", type: glue.Schema.FLOAT },
                { name:  "total_voltage_5", type: glue.Schema.FLOAT },
                { name:  "total_current_5", type: glue.Schema.FLOAT },
                { name:  "cell_max_voltage_5", type: glue.Schema.FLOAT },
                { name:  "cell_min_voltage_5", type: glue.Schema.FLOAT },
                { name:  "max_temperature_5", type: glue.Schema.FLOAT },
                { name:  "min_temperature_5", type: glue.Schema.FLOAT },
                { name:  "total_voltage_4", type: glue.Schema.FLOAT },
                { name:  "total_current_4", type: glue.Schema.FLOAT },
                { name:  "cell_max_voltage_4", type: glue.Schema.FLOAT },
                { name:  "cell_min_voltage_4", type: glue.Schema.FLOAT },
                { name:  "max_temperature_4", type: glue.Schema.FLOAT },
                { name:  "min_temperature_4", type: glue.Schema.FLOAT },
                { name:  "total_voltage_3", type: glue.Schema.FLOAT },
                { name:  "total_current_3", type: glue.Schema.FLOAT },
                { name:  "cell_max_voltage_3", type: glue.Schema.FLOAT },
                { name:  "cell_min_voltage_3", type: glue.Schema.FLOAT },
                { name:  "max_temperature_3", type: glue.Schema.FLOAT },
                { name:  "min_temperature_3", type: glue.Schema.FLOAT },
                { name:  "total_voltage_2", type: glue.Schema.FLOAT },
                { name:  "total_current_2", type: glue.Schema.FLOAT },
                { name:  "cell_max_voltage_2", type: glue.Schema.FLOAT },
                { name:  "cell_min_voltage_2", type: glue.Schema.FLOAT },
                { name:  "max_temperature_2", type: glue.Schema.FLOAT },
                { name:  "min_temperature_2", type: glue.Schema.FLOAT },
                { name:  "total_voltage_1", type: glue.Schema.FLOAT },
                { name:  "total_current_1", type: glue.Schema.FLOAT },
                { name:  "cell_max_voltage_1", type: glue.Schema.FLOAT },
                { name:  "cell_min_voltage_1", type: glue.Schema.FLOAT },
                { name:  "max_temperature_1", type: glue.Schema.FLOAT },
                { name:  "min_temperature_1", type: glue.Schema.FLOAT },
            ],
            dataFormat: glue.DataFormat.JSON,
        }
    );
  }
}
