// daemon.js
// Author: Joel Lubrano

var fs = require('fs');
var request = require('request');
var _ = require('lodash');
var winston = require('winston');

// Constants
var IP_FILE = "ipFile";

var logger = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)(),
        new (winston.transports.File)({
            filename: 'error.log',
            // filename: '/var/log/cloudflareclient.log',
            timestamp: function() {
                var dt = new Date();
                return dt.toString();
            },
            level: 'info' 
        })
    ]
});

/**
 * Hacky function to delete the ipFile so that the next
 * time that the daemon iterates, the ip will be updated.
 */
function deleteIpFile() {
    logger.info("Deleting IP File...");
    fs.unlink(IP_FILE, function(err) {
        if(err) {
            logerr("Delete IP file " + IP_FILE, err);
        }
    });
}

function logerr(msg, error) {
    error = JSON.stringify(error);
    var errmsg = msg + ((error) ? (": " + error) : '');
    logger.error(errmsg);
}

var getCloudflareSettings = function() {
    try {
        var json = fs.readFileSync('cloudflare.settings');
        var settings = JSON.parse(json);
        return settings;
    } catch(e) {
        logerr("Read/parse cloudflare settings file", e);
    }
};

var cloudflareUrl = function(path) {
    var hostname = "https://api.cloudflare.com/client/v4/";
    return hostname + path;
};

var requestHeaders = function() {
    var cloudflareSettings = getCloudflareSettings();
    return {
        "Content-Type": "application/json",
        "X-Auth-Key": cloudflareSettings.apiKey,
        "X-Auth-Email": cloudflareSettings.authEmail
    };
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
        headers: requestHeaders()
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
        } else {
            logger.info("Successfully updated DNS settings!");
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
        headers: requestHeaders(),
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
    var cloudflareSettings = getCloudflareSettings();
    var getZoneOpts = {
        method: 'GET',
        uri: cloudflareUrl("zones/?name=" + cloudflareSettings.appDomain),
        headers: requestHeaders()
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
            logger.info("Zone ID: " + zoneId);
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
    var ipFile = IP_FILE;
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
deleteIpFile();
main();
setInterval(main, interval);

