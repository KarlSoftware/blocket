/**
 * Created by edt on 7/2/15.
 */

var winston = require('winston');
var config  = require('../config');
var exists  = require('./exists');
var async   = require('async');

db = require("seraph")({
    server: config.db.host + ":" + config.db.port,
    user: config.db.username,
    pass: config.db.password
});

lines = {
    red: ["T13","T14"],
    green: ["T17","T18","T19"],
    blue: ["T10", "T11"]
};

module.exports = {
    insertImportantLocation: function ( data, callback ) {
        // data can be any object
        db.save(data, 'Important', function(err, node) {
            if (err) throw err;

            callback(err, node);
        });
    },
    getImportantLocations: function ( callback ) {
        db.nodesWithLabel('Important', callback);
    },
    insertStation: function ( data ) {
        // data can be any object
        db.save(data, 'Station', function(err, node) {
            if (err) throw err;
        });
    },
    allStations: function ( callback ) {
        // callback takes err, results
        db.nodesWithLabel('Station', callback);
    },
    allStationsOnLine: function ( line, callback ) {
        db.nodesWithLabel('Station', function(err, results){
            var filtered = [];
            var associative = {}; // line -> obj

            if ( line in lines ) {
                for (var r in results) {
                    for ( var l in lines[line] ) {
                        if (results[r].lines.indexOf(lines[line][l]) > -1)
                            filtered.push(results[r]);
                    }
                }
            } else {
                for (var r in results) {
                    if (results[r].lines.indexOf(line) > -1)
                        filtered.push(results[r]);
                }
            }

            callback(err, filtered);
        });
    },
    insertAd: function( ad, callback ) {
        db.save(ad, 'Ad', function(err, node) {
            if ( err ) {
                winston.log("error", "error inserting ad in DB", err);
            }

            callback(null, node);
        });
    },
    insertAds: function (ads, callback) {
        async.mapSeries(ads, module.exports.insertAd, function(err, inserted){
            if (err) {
                throw err;
            }

            // finished
            winston.info("inserted " + ads.length + " ads in the DB");
            callback(null,inserted);
        })
    },
    insertRelation: function (edge, callback) {
        db.relate(edge.from, edge.label, edge.to, edge.relation, function(err, rel) {
            if ( err ) {
                winston.log("error", "error creating relationship", err);
                throw err;
            }

            callback(null); //success
        });
    },
    allAds: function ( callback ) {
        db.nodesWithLabel('Ad', function(err, results){
            if (err) {
                throw err;
            }

            winston.info("dowloaded " + results.length + " ads from DB");
            callback(err,results);
        });
    },
    allAdsWithCoordinates: function ( callback ) {
        var cypher = "MATCH (n:Ad) WHERE has(n.latitude) RETURN n";

        db.query(cypher, function(err, results) {
            callback(err,results);
        });
    },
    display: function( duration, price, callback ) {
        var cypher = "MATCH (n:Ad)-[r:Duration]-(s:Important) WHERE has(n.latitude) ";

        if ( duration > 0 ) {
            cypher += "AND r.transit <= " + duration + " ";
        } else {
            // do not use te constraint to be close to a station
            cypher = "MATCH (n:Ad) WHERE has(n.latitude) ";
        }

        if ( price > 0 ) {
            cypher += "AND n.price <= " + price + " ";
        }

        cypher += "RETURN DISTINCT n";
        winston.info(cypher);

        db.query(cypher, function(err, results) {
            callback(err,results);
        });
    },
    allAdsToDisplay: function ( lineOrColor, distance, price, days, callback ) {
        var startTime = (days != 0) ? (Date.now() - days * 24 * 3600 * 1000) : 0;
        var cypher = "MATCH (n:Ad)-[r:Distance]-(s:Station) WHERE has(n.latitude) AND n.time > " + startTime + " ";

        if ( distance > 0 ) {
            cypher += "AND r.straight <= " + distance + " ";

            if ( lineOrColor in lines ) {
                cypher += "AND (";
                for ( i in lines[lineOrColor] ) {
                    cypher += "'" + lines[lineOrColor][i] + "' IN s.lines";
                    if ( i != lines[lineOrColor].length - 1 ) {
                        cypher += " OR ";
                    }
                }
                cypher += ") ";
            } else {
                if ( lineOrColor != "any" ) {
                    cypher += "AND '" + lineOrColor + "' IN s.lines ";
                } else {
                    // any station or line is OK
                }
            }
        } else {
            // do not use te constraint to be close to a station
            cypher = "MATCH (n:Ad) WHERE has(n.latitude) AND n.time > " + startTime + " ";
        }

        if ( price > 0 ) {
            cypher += "AND n.price <= " + price + " ";
        }

        cypher += "RETURN DISTINCT n";
        winston.info(cypher);

        db.query(cypher, function(err, results) {
            callback(err,results);
        });
    },
    deleteDistances: function (callback) {
        var cypher = "MATCH ()-[r:Distance]-() DELETE r";

        db.query(cypher, function(err, results) {
            callback(err, results);
        });
    },
    deleteAd: function (id, callback) {
        winston.log("info", "deleting ad ", id );

        db.delete(id, true, function(err) {
            if (err) {
                winston.log('error', "unable to delete node with id ", id);
            }

            callback(null);
        });
    },
    deleteAdsById: function (adsToDelete, callback) {
        winston.log("info", "deleting " + adsToDelete.length + " ads");

        async.eachSeries(adsToDelete, module.exports.deleteAd,
        function(err){
            if (err) {
                throw err;
            }

            callback(null, adsToDelete);
        });

    },
    // not sure this is the rigth place for this procedure
    clean: function ( callback ) {
        db.nodesWithLabel('Ad', function(err, results) {
            if (err) {
                throw err;
            }

            results.sort(function(a,b){ return a.time < b.time; });

            var uriToIdMap = {};
            for ( var i in results ) {
                uriToIdMap[results[i].uri] = results[i].id;
            }

            var uris = Object.keys(uriToIdMap);
            winston.info("checking " + uris.length + " uris");
            exists.existsAll(uris, function(err, urisToDelete){
                var adsToDelete = [];
                for ( var i in urisToDelete ) {
                    adsToDelete.push(uriToIdMap[urisToDelete[i]]);
                }

                module.exports.deleteAdsById(adsToDelete, callback);
            });
        });
    }
};