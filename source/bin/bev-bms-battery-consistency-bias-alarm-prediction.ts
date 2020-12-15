#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { AwsBevBmsBatteryConsistencyBiasAlarmPredictionStack } from '../lib/bev-bms-battery-consistency-bias-alarm-prediction-stack';

const app = new cdk.App();
new AwsBevBmsBatteryConsistencyBiasAlarmPredictionStack(app, 'AwsBevBmsBatteryConsistencyBiasAlarmPredictionStack');
