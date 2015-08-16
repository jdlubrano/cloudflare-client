// main.js
// Author: Joel Lubrano

var request = require('request');
var _ = require('lodash');
var winston = require('winston');

var logger = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)(),
        new (winston.transports.File)({
            filename: './error.log',
            level: 'error' 
        })
    ]
});

function errorOut(msg, error, errcode) {
    errcode = _.isNumber(errcode) ?  errcode : 1;
    error = JSON.stringify(error);
    var errmsg = msg + ((error) ? (": " + error) : '');
    logger.error(errmsg);
    process.exit(errcode);
}

var cloudflareSettings = {
    "apiKey": "0bcaa0af019075127f76b143f9fb6467e1e34",
    "authEmail": "joel.lubrano@gmail.com",
    "appDomain": "jdlubrano.work",
    "currentIpFile": "currentIp.txt"
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

function checkResponse(response) {
    if(response.statusCode !== 200) {
        errorOut("bad response code (" + response.statusCode.toString() + ")", response);
    }
}

function getDnsRecords(zoneId, callback) {
    var getDnsRecordsOpts = {
        method: 'GET',
        uri: cloudflareUrl("zones/" + zoneId + '/dns_records'),
        headers: requestHeaders
    };
    request(getDnsRecordsOpts, function(error, response, body) {
        logger.info("getting dns records...");
        logger.info(getDnsRecordsOpts);
        if(error) {
            errorOut("getting DNS records", error);
        }
        checkResponse(response);
        try {
            var records = JSON.parse(body).result;
            callback(records);
        } catch(error) {
            errorOut("Parsing dns records", error);
        }
    });
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
    request(
        updateDnsRecordOpts,
        function handleUpdateResponse(error, response, body) {
            if(error) {
                errorOut("updating dns records", error);
            }
            checkResponse(response);
            try {
                var result = JSON.parse(body);
                console.log(body);
                if(result.success !== true) {
                    logger.error("PUT unsuccessful", result);
                }
            } catch(error) {
                logger.error("parsing update response", error);
            }
        }
    );    
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
            errorOut("getting zone", error);
        }
        checkResponse(response);
        try {    
            var zoneId = JSON.parse(body).result[0].id;
            logger.info(zoneId);
            updateIpInZone(zoneId, ip);
        } catch(err) {
            errorOut("parsing 'get zone' body", err);
        }
    });
}

function getMyIp(callback) {
    logger.info("Getting external IP address");
    request("http://ipv4.icanhazip.com", function(error, response, body) {
        if(error) {
            errorOut("getting IP address", error);
        }
        checkResponse(response);
        var ip = body.trim();
        logger.info('External IP is ' + ip);
        callback(ip);
    });
};

(function() {
    getMyIp(updateCloudFlare);
}());

