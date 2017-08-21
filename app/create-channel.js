/**
 * Created by zhaoliang on 2017/8/18.
 */


var log4js = require('log4js');
var User = require('fabric-client/lib/User.js');
var crypto = require('crypto');
var copService = require('fabric-ca-client');

var hfc = require('fabric-client');

var ORGS = hfc.getConfigSetting('network-config');

var clients = {};
var channels = {};
var caClients = {};

var channelName = null;



var util = require('util');
var fs = require('fs');
var path = require('path');
var config = require('../config.json');
var helper = require('./helper.js');
var logger = helper.getLogger('Create-Channel');
//尝试发送一个请求与sendcreatechain方法订购方

var createChannel = function(channelName, channelConfigPath, username, orgName) {
	logger.debug('\n====== Creating Channel \'' + channelName + '\' ======\n');

    function getKeyStoreForOrg(org) {
        return hfc.getConfigSetting('keyValueStore') + '_' + org;
    }

    function setupPeers(channel, org, client) {
        for (let key in ORGS[org].peers) {
            let data = fs.readFileSync(path.join(__dirname, ORGS[org].peers[key]['tls_cacerts']));
            let peer = client.newPeer(
                ORGS[org].peers[key].requests,
                {
                    pem: Buffer.from(data).toString(),
                    'ssl-target-name-override': ORGS[org].peers[key]['server-hostname']
                }
            );
            peer.setName(key);

            channel.addPeer(peer);
        }
    }

    function newOrderer(client) {
        var caRootsPath = ORGS.orderer.tls_cacerts;
        let data = fs.readFileSync(path.join(__dirname, caRootsPath));
        let caroots = Buffer.from(data).toString();
        return client.newOrderer(ORGS.orderer.url, {
            'pem': caroots,
            'ssl-target-name-override': ORGS.orderer['server-hostname']
        });
    }

    // 设置客户端和每个组织通道对象
    for (let key in ORGS) {
        if (key.indexOf('org') === 0) {
            let client = new hfc();

            let cryptoSuite = hfc.newCryptoSuite();
            cryptoSuite.setCryptoKeyStore(hfc.newCryptoKeyStore({path: getKeyStoreForOrg(ORGS[key].name)}));
            client.setCryptoSuite(cryptoSuite);

            let channel = client.newChannel(channelName);
            channel.addOrderer(newOrderer(client));

            clients[key] = client;
            channels[key] = channel;

            setupPeers(channel, key, client);

            let caUrl = ORGS[key].ca;
            caClients[key] = new copService(caUrl, null /*defautl TLS opts*/, '' /* default CA */, cryptoSuite);
        }
    }

    var getClientForOrg = function(org) {
        return clients[org];
    };

	var client = clients[orgName];
	//var channel = helper.getChannelForOrg(orgName);

    var channel = channel[orgName];

	// read in the envelope for the channel config raw bytes
	var envelope = fs.readFileSync(path.join(__dirname, channelConfigPath));
	// extract the channel config bytes from the envelope to be signed
	var channelConfig = client.extractChannelConfig(envelope);

	//Acting as a client in the given organization provided with "orgName" param
	return helper.getOrgAdmin(orgName).then((admin) => {
		logger.debug(util.format('Successfully acquired admin user for the organization "%s"', orgName));
		// sign the channel config bytes as "endorsement", this is required by
		// the orderer's channel creation policy
		let signature = client.signChannelConfig(channelConfig);

		let request = {
			config: channelConfig,
			signatures: [signature],
			name: channelName,
			orderer: channel.getOrderers()[0],
			txId: client.newTransactionID()
		};

		// send to orderer
		logger.info("--------------------------");
		logger.debug(request);
        logger.info("--------------------------");
		return client.createChannel(request);
	}, (err) => {
		logger.error('Failed to enroll user \''+username+'\'. Error: ' + err);
		throw new Error('Failed to enroll user \''+username+'\'' + err);
	}).then((response) => {
		logger.debug(' response ::%j', response);
		if (response && response.status === 'SUCCESS') {
			logger.debug('Successfully created the channel.');
			let response = {
				success: true,
				message: 'Channel \'' + channelName + '\' created Successfully'
			};
		  return response;
		} else {
			logger.error('\n!!!!!!!!! Failed to create the channel \'' + channelName +
				'\' !!!!!!!!!\n\n');
			throw new Error('Failed to create the channel \'' + channelName + '\'');
		}
	}, (err) => {
		logger.error('Failed to initialize the channel: ' + err.stack ? err.stack :
			err);
		throw new Error('Failed to initialize the channel: ' + err.stack ? err.stack : err);
	});
};

exports.createChannel = createChannel;

