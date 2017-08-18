#!/bin/bash
# Created by zhaoliang on 2017/8/16.
#
# SPDX-License-Identifier: Apache-2.0
#
echo "生成通道文件----------------------------开始"

CHANNEL_NAME=$1
echo "通道名称：" ${CHANNEL_NAME}.tx
export FABRIC_CFG_PATH=$PWD

/root/fabric-samples/bin/configtxgen -profile TwoOrgsChannel -outputCreateChannelTx /root/fabric-samples/balance-transfer/artifacts/channel/${CHANNEL_NAME}.tx -channelID ${CHANNEL_NAME}

echo "生成通道文件----------------------------结束"

