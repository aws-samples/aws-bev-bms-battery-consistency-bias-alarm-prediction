#!/bin/bash

set -e

# download scripts and dataset
cd /home/ec2-user/SageMaker
echo "Fetching the scripts and data..."

wget -c https://aws-gcr-solutions.s3.cn-north-1.amazonaws.com.cn/Amazon-bev-bms-battery-consistency-bias-alarm-prediction/latest/series_samples.csv
wget -c https://aws-gcr-solutions.s3.cn-north-1.amazonaws.com.cn/Amazon-bev-bms-battery-consistency-bias-alarm-prediction/latest/xgboost_beginner.ipynb
sudo chmod +777 xgboost_beginner.ipynb
