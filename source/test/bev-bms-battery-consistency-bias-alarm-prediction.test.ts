import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as AwsBevBmsBatteryConsistencyBiasAlarmPrediction from '../lib/bev-bms-battery-consistency-bias-alarm-prediction-stack';

test('test/bev-bms-battery-consistency-bias-alarm-prediction.test.ts', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new AwsBevBmsBatteryConsistencyBiasAlarmPrediction.AwsBevBmsBatteryConsistencyBiasAlarmPredictionStack(app, 'MyTestStack');
    // THEN
    // expectCDK(stack).to(matchTemplate({
    //   "Resources": {}
    // }, MatchStyle.EXACT))
});
