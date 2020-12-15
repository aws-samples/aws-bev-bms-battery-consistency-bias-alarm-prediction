#!/bin/bash
#
# This script creates the ECR image to host superset in ECS Fargate service
#

# Check to see if the required parameters have been provided:
if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
    echo "Please provide the account_id and aws_default_region to build the ecr image."
    echo "For example: ./build-ecr.sh <region_name> <account_id> latest"
    exit 1
fi

# Get reference for all important folders
template_dir="$PWD"
source_dir="$template_dir/../source"

echo "------------------------------------------------------------------------------"
echo "[Init] Get Env"
echo "------------------------------------------------------------------------------"

echo AWS_DEFAULT_REGION $1
echo AWS_ACCOUNT_ID $2

if [[ $1 == cn-* ]];
then
  domain=$2.dkr.ecr.$1.amazonaws.com.cn
  partition=aws-cn
else
  domain=$2.dkr.ecr.$1.amazonaws.com
  partition=aws
fi

echo ECR_DOMAIN $domain

aws ecr get-login-password --region $1 | docker login --username AWS --password-stdin $domain

echo "------------------------------------------------------------------------------"
echo "[Build] Build Docker Image"
echo "------------------------------------------------------------------------------"
echo Building the docker image...
cd $source_dir
IMAGE_REPO_NAME=battery-consistency-bias-alarm-prediction-visualization
IMAGE_TAG=$3
docker build -t $IMAGE_REPO_NAME:$IMAGE_TAG ecr/
docker tag $IMAGE_REPO_NAME:$IMAGE_TAG $domain/$IMAGE_REPO_NAME:$IMAGE_TAG


echo "------------------------------------------------------------------------------"
echo "[Push] Push Docker Image"
echo "------------------------------------------------------------------------------"
echo Push the docker image...
cd $source_dir
aws ecr create-repository --repository-name $IMAGE_REPO_NAME --region $1 >/dev/null 2>&1
docker push $domain/$IMAGE_REPO_NAME:$IMAGE_TAG