// daemon.js
// Author: Joel Lubrano

var fs = require('fs');
var request = require('request');
var _ = require('lodash');
var winston = require('winston');

var logger = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)(),
        new (winston.transports.File)({
            filename: '/var/log/cloudflareclient.log',
            timestamp: function() { return Date.now(); },
            level: 'info' 
        })
    ]
});

function logerr(msg, error) {
    error = JSON.stringify(error);
    var errmsg = msg + ((error) ? (": " + error) : '');
    logger.error(errmsg);
}

var cloudflareSettings = {
    "apiKey": "0bcaa0af019075127f76b143f9fb6467e1e34",
    "authEmail": "joel.lubrano@gmail.com",
    "appDomain": "jdlubrano.work",
};

var cloudflareUrl = function(path) {
    var hostname = "https://api.cloudflare.com/client/v4/";
    return hostname + path;
};

var requestHeaders = {
    "Content-Type": "application/json",
    "X-Auth-Key": cloudflareSettings.apiKey,
    "X-Auth-Email": cloudflareSettings.authEmail
};

function responseGood(response) {
    var responseGood = (response.statusCode === 200);
    if(!responseGood) {
        logerr(
            "bad response code (" +
            response.statusCode.toString() + ")",
            response
        );
    }
    return responseGood;
}

function getDnsRecords(zoneId, callback) {
    var getDnsRecordsOpts = {
        method: 'GET',
        uri: cloudflareUrl("zones/" + zoneId + '/dns_records'),
        headers: requestHeaders
    };
    request(getDnsRecordsOpts, function handleDnsRecords(error, response, body) {
        logger.info("getting dns records...");
        if(error) {
            logerr("getting DNS records", error);
            return;
        }
        if(!responseGood(response)) return;
        try {
            var records = JSON.parse(body).result;
            callback(records);
        } catch(error) {
            logerr("Parsing dns records", error);
        }
    });
}

function handleUpdateResponse(error, response, body) {
    if(error) {
        logerr("updating dns records", error);
        return;
    }
    if(!responseGood(response)) return;
    try {
        var result = JSON.parse(body);
        if(result.success !== true) {
            logger.error("PUT unsuccessful", result);
        }
    } catch(error) {
        logger.error("parsing update response", error);
    }
}

function updateDnsRecord(record, ip) {
    var zoneId = record.zone_id;
    record.content = ip;
    record.modified_on = Date.now();
    var recordStr = JSON.stringify(record);
    var updateDnsRecordOpts = {
        method: 'PUT',
        uri: cloudflareUrl("zones/" + zoneId + "/dns_records/" + record.id),
        headers: requestHeaders,
        body: recordStr
    };
    logger.info('updating dns records');
    request(updateDnsRecordOpts, handleUpdateResponse);    
}

function updateIpInZone(zoneId, ip) {
    getDnsRecords(zoneId, function(dnsRecords) {
        var type_a_records = _.filter(dnsRecords, function(r) {
            return r.type === "A";
        });
        type_a_records.forEach(function(record) {
            updateDnsRecord(record, ip);
        });
    });
}

function updateCloudFlare(ip) {
    var getZoneOpts = {
        method: 'GET',
        uri: cloudflareUrl("zones/?name=" + cloudflareSettings.appDomain),
        headers: requestHeaders
    };
    request(getZoneOpts, function(error, response, body) {
        logger.info("getting zone...");
        if(error) {
            logerr("getting zone", error);
            return;
        }
        if(!responseGood(response)) {
            return;
        }
        try {    
            var zoneId = JSON.parse(body).result[0].id;
            logger.info(zoneId);
            updateIpInZone(zoneId, ip);
        } catch(err) {
            logerr("parsing 'get zone' body", err);
        }
    });
}

function writeIpToFile(ip, ipFile) {
    fs.writeFile(ipFile, ip, function(err) {
        if(err) {
            logerr("writing ip address to file", err);
        } else {
            logger.info("Successfully wrote ip address to " + ipFile);
        }
    });
}

function checkIpChanged(ip, ipChangedCallback, ipUnchangedCallback) {
    var ipFile = "ipFile";
    var fileExists = fs.existsSync(ipFile);
    if(fileExists) {
        fs.readFile(ipFile, function(err, ipRead) {
            if(err) {
                logerr("reading ip file", error);
                return;
            }
            ipRead = ipRead.toString().trim();
            if(ip === ipRead) {
                ipUnchangedCallback(ip, ipRead);
            } else {
                ipChangedCallback(ip);
                writeIpToFile(ip, ipFile);
            }
        });
    } else {
        ipChangedCallback(ip);
        writeIpToFile(ip, ipFile);
    }
}

function getMyIp(callback) {
    logger.info("Getting external IP address");
    request("http://ipv4.icanhazip.com", callback);
};

function handleIpResponse(error, response, body) {
    if(error || !responseGood(response)) {
        logger.error("getting ip address", error, response);
        return;
    }
    if(!responseGood(response)) {
        return;
    }
    var ip = body.trim();
    logger.info('External IP is ' + ip);
    checkIpChanged(ip, updateCloudFlare, function() {
        logger.info("External IP has not changed");
    });
}

function main() {
    getMyIp(handleIpResponse);
}

var interval = 60 * 5 * 1000;  // 5 minutes
main();
setInterval(main, interval);

