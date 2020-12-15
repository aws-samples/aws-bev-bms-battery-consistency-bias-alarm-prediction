[English](./README.md)

# 电动汽车电池管理系统之电池单体一致性偏差报警预测

## 目录
* [方案介绍](#方案介绍)
* [方案架构](#方案架构)
* [方案部署](#方案部署)
  * [部署须知](#部署须知)
  * [部署参数](#部署参数)
  * [基于Cloudformation部署](#基于Cloudformation部署)
  * [基于CDK部署](#基于CDK部署)
* [安全](#安全)
* [许可](#许可)

## 方案介绍
该解决方案基于Amazon S3，Amazon Lambda，Amazon API Gateway，Amazon SageMaker, Amazon DynamoDB服务和开源的Apache Superset组件，旨在提供完整的电动汽车电池管理系统中电池单体一致性偏差报警预测工具链。它包括数据存储工具、数据分析工具、模型处理工具和数据展示工具。该方案在云端提供平滑的工作流程，无需担忧管理TB级别的电池和车联网数据的存储容量和短时间内需要数百个核用于并行算法训练。“我们急需一套工具链帮助我们进行数据处理和预测”，沃尔沃亚太客户与数字化部车联网负责人Kevin说，“POC表明，这个方案可以让我们在缺乏数据分析工程师和数学科学家很快地在AWS云上搭建故障预测平台并且获得期望的结果。”


## 方案架构
![Battery Consistency Bias Alarm Prediction Architect](battery-consistency-bias-alarm-prediction-architect-with-bg.png)

架构图中各个组件之间的关系用连接箭头表示，其具体含义分别为:

1. 主机厂或电池厂商将采集的电池数据上传至AWS S3桶中，用于模型建模和训练；
1. Sagemaker Notebook Instance获取电池数据；
1. 在Sagemaker Notebook Instance中完成模型建模，训练和部署，部署后的Inference Model是一个Runtime Endpoint，它用来提供预测推理服务；
1. 应用场景一：车辆网上传的数据推送到的S3桶，S3桶中新增加的Batch数据即为需要推理的数据；
1. 应用场景一：新增加的Batch数据自动调用Lambda进行转发请求；
1. 应用场景一：Lambda调用Sagemaker Runtime Endpoint进行前向推理；
1. 应用场景一：前向推理的结果写入到Dynamo DB进行存储；
1. *应用场景一：前向推理的结果写入到S3进行存储（供Superset可视化）；*
1. 应用场景二：用户调用API进行前向预测推理，用户采用POST调用；
1. 应用场景二：API Gateway将请求路由到Lambda函数；
1. 应用场景二：Lambda调用Sagemaker Runtime Endpoint进行前向推理；
1. 应用场景二：前向推理的结果写入到Dynamo DB进行存储；
1. *应用场景二：前向推理的结果写入到S3进行存储（供Superset可视化）；*
1. Superset后台部署在Fargate Service, 基于SQL数据查询访问实时推理结果的数据；
1. Athena从AWS Glue Data Catalog中的数据库和表中查询数据；
1. Glue Data Catalog的表格Schema是对预测结果S3桶中记录的定义；


## 方案部署

#### 部署须知

- 该解决方案在部署过程中会自动地在您的账户中配置S3桶，API Gateway， Lambda，Dynamodb表，ECS Fargate服务，Sagemaker笔记本实例，Glue Data Catalog表等等。
- 整个部署过程耗时约为 5-10 分钟。

#### 部署参数

在解决方案部署时，需要指定`sagemakerEndpointName`参数:

| 参数                 | 默认值                                             | 描述                                                                                     |
|---------------------------|-----------------------------------------------------|-------------------------------------------------------------------------------------------------|
| sagemakerEndpointName     | battery-consistency-bias-alarm-prediction-endpoint  | Sagemaker推理终端名称, 它需要跟Sagemaker笔记本中模型部署时指定的终端名保持一致. |


#### 基于Cloudformation部署

请参考下述步骤来基于Cloudformation进行部署：

1. 登录AWS管理控制台，切换到您想将该解决方案部署到的区域；

1. 点击下述按钮（中国与海外）来开启部署；

    - 标准（Standard)区域

    [![Launch Stack](launch-stack.svg)](https://console.aws.amazon.com/cloudformation/home#/stacks/create/template?stackName=BatteryConsistencyBiasAlarmPrediction&templateURL=https://aws-gcr-solutions.s3.amazonaws.com/Amazon-bev-bms-battery-consistency-bias-alarm-prediction/latest/AwsBevBmsBatteryConsistencyBiasAlarmPredictionStack.template)

    - 中国区域（宁夏/北京）

    [![Launch Stack](launch-stack.svg)](https://console.amazonaws.cn/cloudformation/home#/stacks/create/template?stackName=BatteryConsistencyBiasAlarmPrediction&templateURL=https://aws-gcr-solutions.s3.cn-north-1.amazonaws.com.cn/Amazon-bev-bms-battery-consistency-bias-alarm-prediction/latest/AwsBevBmsBatteryConsistencyBiasAlarmPredictionStack.template)

1. 点击 **下一步**. 根据您需要可以更改堆栈名称；

1. 点击 **下一步**. 配置堆栈选项 (可选)；

1. 点击 **下一步**. 审核堆栈配置，勾选 **我确认，AWS CloudFormation 可能创建具有自定义名称的 IAM 资源**，点击 **创建堆栈** 开启创建；

> 注意: 当您不再需要该解决方案时，您可以直接从Cloudformation控制台删除它。


#### 基于CDK部署

如果您想基于AWS CDK部署该解决方案，请您确认您的部署环境满足下述前提条件：

* [AWS Command Line Interface](https://aws.amazon.com/cli/)
* Node.js 12.x or 更高版本

在 **source** 文件夹下, 执行下述命令将TypeScript编译成JavaScript；

```
cd source
npm install -g aws-cdk
npm install && npm run build
```

然后您可以执行 `cdk deploy` 命令开启部署该解决方案，如下所示，也可以不指定`sagemakerEndpointName`名（使用默认值）：

```
cdk deploy --parameters sagemakerEndpointName=<your_sagemaker_runtime_endpoint>
```

> 注意: 当您不再需要该解决方案时，您可以执行 `cdk destroy` 命令，该命令会将部署账户中该解决方案创建的资源移除掉。


## 安全
更多信息请参阅 [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications)。

## 许可
该解决方案遵从MIT-0 许可，更多信息请参阅 LICENSE 文件.

