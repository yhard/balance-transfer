var log4js = require('log4js');

var fs = require('fs-extra');
var User = require('fabric-client/lib/User.js');
var crypto = require('crypto');
var copService = require('fabric-ca-client');

var hfc = require('fabric-client');

var ORGS = hfc.getConfigSetting('network-config');

var clients = {};
var channels = {};
var caClients = {};


var util = require('util');
var path = require('path');
var fs1 = require('fs');

var Peer = require('fabric-client/lib/Peer.js');
var EventHub = require('fabric-client/lib/EventHub.js');
var tx_id = null;
var nonce = null;
var config = require('../config.json');
var helper = require('./helper.js');
var logger = helper.getLogger('Join-Channel');
var ORGS = helper.ORGS;
var allEventhubs = [];

//
//加入通道
//
var joinChannel = function(channelName, peers, username, org) {

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

	var closeConnections = function(isSuccess) {
		if (isSuccess) {
			logger.debug('\n============ Join Channel is SUCCESS ============\n');
		} else {
			logger.debug('\n!!!!!!!! ERROR: Join Channel FAILED !!!!!!!!\n');
		}
		logger.debug('');

		for (var key in allEventhubs) {
			var eventhub = allEventhubs[key];
			if (eventhub && eventhub.isconnected()) {
				eventhub.disconnect();
			}
		}
	};
	logger.debug('\n============ Join Channel ============\n')
	logger.info(util.format('Calling peers in organization "%s" to join the channel', org));

	var client = this.getClientForOrg(org);

	//var channel = helper.getChannelForOrg(org);

    var channel = this.getChannelForOrg(org);

	logger.info("---------------------------------------");
	logger.debug(channel);
	logger.info("---------------------------------------");

	var eventhubs = [];

	return this.getOrgAdmin(org).then((admin) => {
		logger.info(util.format('received member object for admin of the organization "%s": ', org));

		tx_id = client.newTransactionID();
		let request = {
			txId : 	tx_id
		};

        logger.info("****************************************");
        logger.debug(request);
        logger.info("****************************************");

		return channel.getGenesisBlock(request);

	}).then((genesis_block) => {
		tx_id = client.newTransactionID();
		var request = {
			targets: this.newPeers(peers, org),
			txId: tx_id,
			block: genesis_block
		};

		eventhubs = this.newEventHubs(peers, org);
		for (let key in eventhubs) {
			let eh = eventhubs[key];
			eh.connect();
			allEventhubs.push(eh);
		}

		var eventPromises = [];
		eventhubs.forEach((eh) => {
			let txPromise = new Promise((resolve, reject) => {
				let handle = setTimeout(reject, parseInt(config.eventWaitTime));
				eh.registerBlockEvent((block) => {
					clearTimeout(handle);
					// in real-world situations, a peer may have more than one channels so
					// we must check that this block came from the channel we asked the peer to join
					if (block.data.data.length === 1) {
						// Config block must only contain one transaction
						var channel_header = block.data.data[0].payload.header.channel_header;
						if (channel_header.channel_id === channelName) {
							resolve();
						}
						else {
							reject();
						}
					}
				});
			});
			eventPromises.push(txPromise);
		});
		let sendPromise = channel.joinChannel(request);
		return Promise.all([sendPromise].concat(eventPromises));
	}, (err) => {
		logger.error('Failed to enroll user \'' + username + '\' due to error: ' +
			err.stack ? err.stack : err);
		throw new Error('Failed to enroll user \'' + username +
			'\' due to error: ' + err.stack ? err.stack : err);
	}).then((results) => {
		logger.debug(util.format('Join Channel R E S P O N S E : %j', results));
		if (results[0] && results[0][0] && results[0][0].response && results[0][0]
			.response.status == 200) {
			logger.info(util.format(
				'Successfully joined peers in organization %s to the channel \'%s\'',
				org, channelName));
			closeConnections(true);
			let response = {
				success: true,
				message: util.format(
					'Successfully joined peers in organization %s to the channel \'%s\'',
					org, channelName)
			};
			return response;
		} else {
			logger.error(' Failed to join channel');
			closeConnections();
			throw new Error('Failed to join channel');
		}
	}, (err) => {
		logger.error('Failed to join channel due to error: ' + err.stack ? err.stack :
			err);
		closeConnections();
		throw new Error('Failed to join channel due to error: ' + err.stack ? err.stack :
			err);
	});
};


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

function readAllFiles(dir) {
    var files = fs.readdirSync(dir);
    var certs = [];
    files.forEach((file_name) => {
        let file_path = path.join(dir,file_name);
        let data = fs.readFileSync(file_path);
        certs.push(data);
    });
    return certs;
}

function getOrgName(org) {
    return ORGS[org].name;
}

function getKeyStoreForOrg(org) {
    return hfc.getConfigSetting('keyValueStore') + '_' + org;
}

function newRemotes(names, forPeers, userOrg) {
    let client = getClientForOrg(userOrg);

    let targets = [];
    // find the peer that match the names
    for (let idx in names) {
        let peerName = names[idx];
        if (ORGS[userOrg].peers[peerName]) {
            // found a peer matching the name
            let data = fs.readFileSync(path.join(__dirname, ORGS[userOrg].peers[peerName]['tls_cacerts']));
            let grpcOpts = {
                pem: Buffer.from(data).toString(),
                'ssl-target-name-override': ORGS[userOrg].peers[peerName]['server-hostname']
            };

            if (forPeers) {
                targets.push(client.newPeer(ORGS[userOrg].peers[peerName].requests, grpcOpts));
            } else {
                let eh = client.newEventHub();
                eh.setPeerAddr(ORGS[userOrg].peers[peerName].events, grpcOpts);
                targets.push(eh);
            }
        }
    }

    if (targets.length === 0) {
        logger.error(util.format('Failed to find peers matching the names %s', names));
    }

    return targets;
}

//-------------------------------------//
// APIs
//-------------------------------------//
var getChannelForOrg = function(org) {
    return channels[org];
};

var getClientForOrg = function(org) {
    return clients[org];
};

var newPeers = function(names, org) {
    return newRemotes(names, true, org);
};

var newEventHubs = function(names, org) {
    return newRemotes(names, false, org);
};

var getMspID = function(org) {
    logger.debug('Msp ID : ' + ORGS[org].mspid);
    return ORGS[org].mspid;
};

var getAdminUser = function(userOrg) {
    var users = hfc.getConfigSetting('admins');
    var username = users[0].username;
    var password = users[0].secret;
    var member;
    var client = getClientForOrg(userOrg);

    return hfc.newDefaultKeyValueStore({
        path: getKeyStoreForOrg(getOrgName(userOrg))
    }).then((store) => {
        client.setStateStore(store);
        // clearing the user context before switching
        client._userContext = null;
        return client.getUserContext(username, true).then((user) => {
            if (user && user.isEnrolled()) {
                logger.info('Successfully loaded member from persistence');
                return user;
            } else {
                let caClient = caClients[userOrg];
                // need to enroll it with CA server
                return caClient.enroll({
                    enrollmentID: username,
                    enrollmentSecret: password
                }).then((enrollment) => {
                    logger.info('Successfully enrolled user \'' + username + '\'');
                    member = new User(username);
                    member.setCryptoSuite(client.getCryptoSuite());
                    return member.setEnrollment(enrollment.key, enrollment.certificate, getMspID(userOrg));
                }).then(() => {
                    return client.setUserContext(member);
                }).then(() => {
                    return member;
                }).catch((err) => {
                    logger.error('Failed to enroll and persist user. Error: ' + err.stack ?
                        err.stack : err);
                    return null;
                });
            }
        });
    });
};

var getRegisteredUsers = function(username, userOrg, isJson) {
    var member;
    var client = getClientForOrg(userOrg);
    var enrollmentSecret = null;
    return hfc.newDefaultKeyValueStore({
        path: getKeyStoreForOrg(getOrgName(userOrg))
    }).then((store) => {
        client.setStateStore(store);
        // clearing the user context before switching
        client._userContext = null;
        return client.getUserContext(username, true).then((user) => {
            if (user && user.isEnrolled()) {
                logger.info('Successfully loaded member from persistence');
                return user;
            } else {
                let caClient = caClients[userOrg];
                return getAdminUser(userOrg).then(function(adminUserObj) {
                    member = adminUserObj;
                    return caClient.register({
                        enrollmentID: username,
                        affiliation: userOrg + '.department1'
                    }, member);
                }).then((secret) => {
                    enrollmentSecret = secret;
                    logger.debug(username + ' registered successfully');
                    return caClient.enroll({
                        enrollmentID: username,
                        enrollmentSecret: secret
                    });
                }, (err) => {
                    logger.debug(username + ' failed to register');
                    return '' + err;
                    //return 'Failed to register '+username+'. Error: ' + err.stack ? err.stack : err;
                }).then((message) => {
                    if (message && typeof message === 'string' && message.includes(
                            'Error:')) {
                        logger.error(username + ' enrollment failed');
                        return message;
                    }
                    logger.debug(username + ' enrolled successfully');

                    member = new User(username);
                    member._enrollmentSecret = enrollmentSecret;
                    return member.setEnrollment(message.key, message.certificate, getMspID(userOrg));
                }).then(() => {
                    client.setUserContext(member);
                    return member;
                }, (err) => {
                    logger.error(util.format('%s enroll failed: %s', username, err.stack ? err.stack : err));
                    return '' + err;
                });;
            }
        });
    }).then((user) => {
        if (isJson && isJson === true) {
            var response = {
                success: true,
                secret: user._enrollmentSecret,
                message: username + ' enrolled Successfully',
            };
            return response;
        }
        return user;
    }, (err) => {
        logger.error(util.format('Failed to get registered user: %s, error: %s', username, err.stack ? err.stack : err));
        return '' + err;
    });
};

var getOrgAdmin = function(userOrg) {
    var admin = ORGS[userOrg].admin;
    var keyPath = path.join(__dirname, admin.key);
    var keyPEM = Buffer.from(readAllFiles(keyPath)[0]).toString();
    var certPath = path.join(__dirname, admin.cert);
    var certPEM = readAllFiles(certPath)[0].toString();

    var client = getClientForOrg(userOrg);
    var cryptoSuite = hfc.newCryptoSuite();
    if (userOrg) {
        cryptoSuite.setCryptoKeyStore(hfc.newCryptoKeyStore({path: getKeyStoreForOrg(getOrgName(userOrg))}));
        client.setCryptoSuite(cryptoSuite);
    }

    return hfc.newDefaultKeyValueStore({
        path: getKeyStoreForOrg(getOrgName(userOrg))
    }).then((store) => {
        client.setStateStore(store);

        return client.createUser({
            username: 'peer'+userOrg+'Admin',
            mspid: getMspID(userOrg),
            cryptoContent: {
                privateKeyPEM: keyPEM,
                signedCertPEM: certPEM
            }
        });
    });
};

var setupChaincodeDeploy = function() {
    process.env.GOPATH = path.join(__dirname, hfc.getConfigSetting('CC_SRC_PATH'));
};

var getLogger = function(moduleName) {
    var logger = log4js.getLogger(moduleName);
    logger.setLevel('DEBUG');
    return logger;
};

exports.getChannelForOrg = getChannelForOrg;
exports.getClientForOrg = getClientForOrg;
exports.getLogger = getLogger;
exports.setupChaincodeDeploy = setupChaincodeDeploy;
exports.getMspID = getMspID;
exports.ORGS = ORGS;
exports.newPeers = newPeers;
exports.newEventHubs = newEventHubs;
exports.getRegisteredUsers = getRegisteredUsers;
exports.getOrgAdmin = getOrgAdmin;
exports.joinChannel = joinChannel;
