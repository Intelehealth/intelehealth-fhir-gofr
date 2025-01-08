/* eslint-disable radix */
/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
/* eslint-disable no-param-reassign */
/* eslint-disable consistent-return */
const request = require('request');
const URI = require('urijs');
const uuid5 = require('uuid/v5');
const uuid4 = require('uuid/v4');
const async = require('async');
const csv = require('fast-csv');
const isJSON = require('is-json');
const levenshtein = require('fast-levenshtein');
const geodist = require('geodist');
const redis = require('redis');
const moment = require('moment');
const lodash = require('lodash');
const jsonmerger = require('json-merger');
const mixin = require('./mixin');
const config = require('./config');
const logger = require('./winston');
const codesystem = require('../terminologies/gofr-codesystem.json');
const fhirAxios = require('./modules/fhirAxios');
const uploadToSql = require("./modules/uploadToSql")
const { pool } = require("./modules/postgres");

const topOrgName = config.get('mCSD:fakeOrgName');

const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || '127.0.0.1',
});

module.exports = () => ({
  getTerminologyCode(code) {
    return codesystem.concept.find(concept => concept.code === code);
  },

  getCodeSystem({
    codeSystemURI,
    code,
    database,
  }, callback) {
    if (!database) {
      database = config.get('mCSD:registryDB');
    }
    let url = URI(fhirAxios.__genUrl());
    if (database) {
      url = url.segment(database);
    }
    url = url.segment('CodeSystem');
    if (codeSystemURI) {
      url.addQuery('url', codeSystemURI);
    }
    if (code) {
      url.addQuery('code', code);
    }
    url = url.toString();
    const codeSystems = {};
    codeSystems.entry = [];
    async.doWhilst(
      (callback) => {
        const options = {
          url,
          headers: {
            'Cache-Control': 'no-cache',
          },
        };
        url = false;
        request.get(options, (err, res, body) => {
          if (!isJSON(body)) {
            return callback(false, false);
          }
          const mcsd = JSON.parse(body);
          const next = mcsd.link.find(link => link.relation == 'next');
          if (next) {
            url = next.url;
          }
          if (mcsd.entry && mcsd.entry.length > 0) {
            codeSystems.entry = codeSystems.entry.concat(mcsd.entry);
          }
          return callback(false, url);
        });
      },
      () => url != false,
      () => {
        callback(codeSystems);
      },
    );
  },

  getCodeSystemFromCodesMinimal({
    codes,
    codeSystemName,
  }, callback) {
    const codeSystemURI = mixin.getCodesysteURI(codeSystemName);
    let concepts = [];
    if (Array.isArray(codes) && codes.length > 0) {
      this.getCodeSystem({
        codeSystemURI: codeSystemURI.uri,
      }, (codeSystems) => {
        async.each(codeSystems.entry, (codeSystem, nxtSyst) => {
          const codeConcept = codeSystem.resource.concept.filter(concept => codes.includes(concept.code));
          concepts = concepts.concat(codeConcept);
          return nxtSyst();
        }, () => callback(concepts));
      });
    } else {
      return callback(null);
    }
  },

  getOrganizationByID({
    database,
    id,
  }, callback) {
    if (!database) {
      database = config.get('mCSD:registryDB');
    }
    let url = URI(fhirAxios.__genUrl());
    if (database) {
      url = url.segment(database);
    }
    url = url.segment('Organization');
    if (id) {
      url = `${url}?_id=${id.toString()}`;
    } else {
      url = url.toString();
    }
    const organizations = {};
    organizations.entry = [];
    async.doWhilst(
      (callback) => {
        const options = {
          url,
          headers: {
            'Cache-Control': 'no-cache',
          },
        };
        url = false;
        request.get(options, (err, res, body) => {
          if (!isJSON(body)) {
            return callback(false, false);
          }
          const mcsd = JSON.parse(body);
          const next = mcsd.link.find(link => link.relation == 'next');
          if (next) {
            url = next.url;
          }
          if (mcsd.entry && mcsd.entry.length > 0) {
            organizations.entry = organizations.entry.concat(mcsd.entry);
          }
          return callback(false, url);
        });
      },
      () => url != false,
      () => {
        callback(organizations);
      },
    );
  },

  getServices({
    database,
    id,
  }, callback) {
    if (!database) {
      database = config.get('mCSD:registryDB');
    }
    const baseUrl = URI(fhirAxios.__genUrl(database)).segment('HealthcareService');
    let url = baseUrl;
    baseUrl.toString();
    if (id) {
      url.addQuery('_id', id);
    }
    url = url.toString();
    let services;
    redisClient.get(`url_${baseUrl}`, (error, results) => {
      if (results) {
        logger.info(`Getting ${baseUrl} from cache`);
        return callback(results);
      }
      services = {
        entry: [],
      };

      let started;
      redisClient.get(`started_${baseUrl}`, (err, resultsSt) => {
        started = resultsSt;
      });
      if (started) {
        logger.info(`getServices is in progress will try again in 10 seconds.${baseUrl}`);
        setTimeout(() => {
          this.getLocations({
            database,
            id,
          }, callback);
        }, 10000);
        return;
      }
      redisClient.set(`started_${baseUrl}`, '');
      logger.info(`Getting ${baseUrl} from server`);
      async.doWhilst(
        (callback) => {
          const options = {
            url,
            headers: {
              'Cache-Control': 'no-cache',
            },
          };
          url = false;
          request.get(options, (err, res, body) => {
            if (!isJSON(body)) {
              this.cleanCache(`started_${baseUrl}`, true);
              return callback(false, false);
            }
            body = JSON.parse(body);
            if (body.total == 0 && body.entry && body.entry.length > 0) {
              logger.error('Non mCSD data returned');
              this.cleanCache(`started_${baseUrl}`, true);
              return callback(false, false);
            }
            const next = body.link.find(link => link.relation == 'next');
            if (next) {
              url = next.url;
            }
            if (body.entry && body.entry.length > 0) {
              services.entry = services.entry.concat(body.entry);
            }
            return callback(false, url);
          });
        },
        () => url != false,
        () => {
          if (services.entry.length > 1) {
            logger.info(`Saving ${baseUrl} to cache`);
            redisClient.set(`url_${baseUrl}`, JSON.stringify(services), 'EX', config.get('mCSD:cacheTime'));
          }
          this.cleanCache(`started_${baseUrl}`, true);
          return callback(services);
        },
      );
    });
  },
  countLocations(database, callback) {
    const baseUrl = URI(fhirAxios.__genUrl(database)).segment('Location')
      .toString();
    let url = `${baseUrl}?_count=0&_total=accurate`;
    const options = {
      url,
      headers: {
        'Cache-Control': 'no-cache',
      },
    };
    request.get(options, (err, res, body) => {
      if(err) {
        return callback(null, 0);
      }
      if (!isJSON(body)) {
        return callback(null, 0);
      }
      body = JSON.parse(body);
      return callback(body.total);
    })
  },
  getLocations(database, callback) {
    const baseUrl = URI(fhirAxios.__genUrl(database)).segment('Location')
      .toString();
    let url = `${baseUrl}?_count=37000`;
    let locations;
    redisClient.get(`url_${baseUrl}`, (error, results) => {
      if (results) {
        try {
          locations = JSON.parse(results);
        } catch (err) {
          logger.error(err);
        }
      }
      if (locations) {
        logger.info(`Getting ${baseUrl} from cache`);
        return callback(locations);
      }
      locations = {
        entry: [],
      };

      let started;
      redisClient.get(`started_${baseUrl}`, (err, resultsSt) => {
        started = resultsSt;
      });
      if (started) {
        logger.info(`getLocations is in progress will try again in 10 seconds.${baseUrl}`);
        setTimeout(() => {
          this.getLocations(database, callback);
        }, 10000);
        return;
      }
      redisClient.set(`started_${baseUrl}`, '');
      logger.info(`Getting ${baseUrl} from server`);
      async.doWhilst(
        (callback) => {
          const options = {
            url,
            headers: {
              'Cache-Control': 'no-cache',
            },
          };
          url = false;
          request.get(options, (err, res, body) => {
            if (!isJSON(body)) {
              this.cleanCache(`started_${baseUrl}`, true);
              return callback(null, false);
            }
            body = JSON.parse(body);
            if (!body.resourceType) {
              logger.error('Non mCSD data returned');
              this.cleanCache(`started_${baseUrl}`, true);
              return callback(null, false);
            }
            const next = body.link && body.link.find(link => link.relation == 'next');
            if (next) {
              url = next.url;
            }
            if (body.entry && body.entry.length > 0) {
              locations.entry = locations.entry.concat(body.entry);
            }
            return callback(null, url);
          });
        },
        () => url !== false,
        () => {
          if (locations.entry.length > 1) {
            logger.info(`Saving ${baseUrl} to cache`);
            redisClient.set(`url_${baseUrl}`, JSON.stringify(locations), 'EX', config.get('mCSD:cacheTime'));
          } else {
            logger.info(`Not more than 1 entry for ${baseUrl} so not caching.`);
          }
          this.cleanCache(`started_${baseUrl}`, true);
          return callback(locations);
        },
      );
    });
  },

  getLocationByID(database, id, includeFacilityOrganization, callback) {
    if (!database) {
      database = config.get('mCSD:registryDB');
    }
    let url = URI(fhirAxios.__genUrl());
    if (database) {
      url = url.segment(database);
    }
    url = url.segment('Location');
    if (id) {
      url.addQuery('_id', id);
    }
    if (includeFacilityOrganization) {
      url.addQuery('_include', 'Location:organization');
    }
    url = url.toString();

    const locations = {};
    locations.entry = [];
    async.doWhilst(
      (callback) => {
        const options = {
          url,
          headers: {
            'Cache-Control': 'no-cache',
          },
        };
        url = false;
        request.get(options, (err, res, body) => {
          if (!isJSON(body)) {
            return callback(false, false);
          }
          const mcsd = JSON.parse(body);
          const next = mcsd.link.find(link => link.relation == 'next');
          if (next) {
            url = next.url;
          }
          if (mcsd.entry && mcsd.entry.length > 0) {
            locations.entry = locations.entry.concat(mcsd.entry);
          }
          return callback(false, url);
        });
      },
      () => url != false,
      () => {
        callback(locations);
      },
    );
  },

  getLocationByIdentifier(database, identifier, callback) {
    const locations = {};
    locations.entry = [];
    if (identifier) {
      var url = `${URI(fhirAxios.__genUrl(database)).segment('Location')}?identifier=${identifier}`.toString();
    } else {
      return callback(locations);
    }
    async.doWhilst(
      (callback) => {
        const options = {
          url,
          headers: {
            'Cache-Control': 'no-cache',
          },
        };
        url = false;
        request.get(options, (err, res, body) => {
          if (!isJSON(body)) {
            return callback(false, false);
          }
          body = JSON.parse(body);
          const next = body.link.find(link => link.relation == 'next');
          if (next) {
            url = next.url;
          }
          if (body.entry && body.entry.length > 0) {
            locations.entry = locations.entry.concat(body.entry);
          }
          return callback(false, url);
        });
      },
      () => url != false,
      () => {
        callback(locations);
      },
    );
  },
  getLocationChildrenSql({database, parent}) {
    if(database == 'Geoalignsqle9b41c35-7c85-46df-aeea-a4e8dbf0364e') {
      database = 'geoalign'
    }
    return new Promise((resolve, reject) => {
      if (!database) {
        database = config.get('mCSD:registryDB');
      }
      if (!parent) {
        parent = "parent IS NULL"
      } else {
        parent = `id='${parent}'`
      }
      pool.query(`
        WITH RECURSIVE ${database}_cte(root, id, name, code, otherId, tag, parent) AS (
            SELECT 
                id AS root,
                id,
                name,
                code,
                otherId,
                tag,
                parent             
                FROM ${database}
                WHERE ${parent}                               
            UNION
                SELECT 
                ${database}_cte.root,
                ${database}.id,
                ${database}.name,
                ${database}.code,
                ${database}.otherId,
                ${database}.tag,
                ${database}.parent
                    FROM ${database}
                    JOIN ${database}_cte 
                    ON ${database}.parent = ${database}_cte.id
        )                       
        SELECT * 
        FROM ${database}_cte;
      `).then((response) => {
        resolve(response)
      })
    })
  },
  getLocationChildren({
    database,
    parent,
  }, callback) {
    if (!database) {
      database = config.get('mCSD:registryDB');
    }
    if (!parent) {
      parent = '';
    }
    let baseUrl = URI(fhirAxios.__genUrl());
    if (database) {
      baseUrl = baseUrl.segment(database);
    }
    baseUrl = baseUrl.segment('Location').toString();
    let url = baseUrl;
    if (parent) {
      url += `?_id=${parent}&_revinclude:recurse=Location:partof`;
    }
    url = url.toString();
    const locations = {
      entry: [],
    };
    logger.info(`Getting ${url} from server`);
    async.doWhilst(
      (doCallback) => {
        const options = {
          url,
          headers: {
            'Cache-Control': 'no-cache',
          },
        };
        url = false;
        request.get(options, (err, res, body) => {
          if (!isJSON(body)) {
            return doCallback(false, false);
          }
          body = JSON.parse(body);
          if (body.total == 0 && body.entry && body.entry.length > 0) {
            logger.error('Non mCSD data returned');
            return doCallback(false, false);
          }
          if (!body.entry || body.entry.length === 0) {
            return doCallback(false, false);
          }
          const next = body.link.find(link => link.relation == 'next');
          if (next) {
            url = next.url;
          }
          locations.entry = locations.entry.concat(body.entry);
          return doCallback(false, url);
        });
      },
      () => url != false,
      () => callback(locations),
    );
  },

  getImmediateChildren(database, id, callback) {
    let url = `${URI(fhirAxios.__genUrl(database)).segment('Location')}?partof=${id.toString()}`;
    const locations = {};
    locations.entry = [];
    async.doWhilst(
      (callback) => {
        const options = {
          url,
          headers: {
            'Cache-Control': 'no-cache',
          },
        };
        url = false;
        request.get(options, (err, res, body) => {
          if (!isJSON(body)) {
            return callback(false, false);
          }
          const mcsd = JSON.parse(body);
          const next = mcsd.link.find(link => link.relation == 'next');
          if (next) {
            url = next.url;
          }
          if (mcsd.entry && mcsd.entry.length > 0) {
            locations.entry = locations.entry.concat(mcsd.entry);
          }
          return callback(false, url);
        });
      },
      () => url != false,
      () => {
        callback(false, locations);
      },
    );
  },

  getLocationParentsFromDB(database, entityParent, topOrg, details, callback) {
    const parents = [];
    if (entityParent == null
      || entityParent == false
      || entityParent == undefined
      || !topOrg
      || !database
    ) {
      return callback(parents);
    }
    const sourceEntityID = entityParent;
    const me = this;

    function getPar(entityParent, callback) {
      if (entityParent == null || entityParent == false || entityParent == undefined) {
        return callback(parents);
      }

      const splParent = entityParent.split('/');
      entityParent = splParent[(splParent.length - 1)];
      const url = `${URI(fhirAxios.__genUrl(database)).segment('Location')}?_id=${entityParent.toString()}`;

      const options = {
        url,
        headers: {
          'Cache-Control': 'no-cache',
        },
      };

      request.get(options, (err, res, body) => {
        if (!isJSON(body)) {
          return callback(parents);
        }
        body = JSON.parse(body);
        let long = null;
        let lat = null;
        if (!body.entry || body.entry.length === 0) {
          logger.error('Empty mcsd data received, this wasnt expected');
          return callback(parents);
        }
        if (body.entry[0].resource.hasOwnProperty('position')) {
          long = body.entry[0].resource.position.longitude;
          lat = body.entry[0].resource.position.latitude;
        }
        entityParent = null;
        if (body.entry[0].resource.hasOwnProperty('partOf')) {
          entityParent = body.entry[0].resource.partOf.reference;
        }

        if (details == 'all') {
          parents.push({
            text: body.entry[0].resource.name,
            id: body.entry[0].resource.id,
            lat,
            long,
          });
        } else if (details == 'id') {
          parents.push(body.entry[0].resource.id);
        } else if (details == 'names') {
          parents.push(body.entry[0].resource.name);
        } else {
          logger.error('parent details (either id,names or all) to be returned not specified');
        }

        // stop after we reach the topOrg which is the country
        // if this is a topOrg then end here,we dont need to fetch the upper org which is continent i.e Africa
        if (entityParent && topOrg && entityParent.endsWith(topOrg)) {
          me.getLocationByID(database, topOrg, false, (loc) => {
            if (details == 'all') {
              parents.push({
                text: loc.entry[0].resource.name,
                id: topOrg,
                lat,
                long,
              });
            } else if (details == 'id') {
              parents.push(loc.entry[0].resource.id);
            } else if (details == 'names') {
              parents.push(loc.entry[0].resource.name);
            }
            return callback(parents);
          });
        }

        // if this is a topOrg then end here,we dont need to fetch the upper org which is continent i.e Africa
        else if (topOrg && sourceEntityID.endsWith(topOrg)) {
          return callback(parents);
        } else if (body.entry[0].resource.hasOwnProperty('partOf')
          && body.entry[0].resource.partOf.reference != false
          && body.entry[0].resource.partOf.reference != null
          && body.entry[0].resource.partOf.reference != undefined) {
          entityParent = body.entry[0].resource.partOf.reference;
          getPar(entityParent, (parents) => {
            callback(parents);
          });
        } else callback(parents);
      });
    }
    getPar(entityParent, parents => callback(parents));
  },

  /*
  This function finds parents of an entity from passed mCSD data
  */
  getLocationParentsFromData(entityParent, mcsd, details, callback) {
    if (mcsd.hasOwnProperty('parentCache') && mcsd.parentCache.id === entityParent && mcsd.parentCache.details === details) {
      // return a copy
      return callback(mcsd.parentCache.parents.slice());
    }
    const parents = [];
    if (!mcsd.length === 0 || !entityParent) {
      return callback(parents);
    }

    function filter(entityParent, callback) {

      const entry = mcsd.find(entry => entry.id == entityParent);

      if (entry) {
        let long = null;
        let lat = null;
        if (entry.longitude) {
          long = entry.longitude;
          lat = entry.latitude;
        }
        if (entry.latitude) {
          lat = entry.latitude;
        }
        var entityParent = null;
        if (entry.parent) {
          entityParent = entry.parent;
        }

        if (details == 'all' || !details) {
          parents.push({
            text: entry.name,
            id: entry.id,
            lat,
            long,
          });
        } else if (details == 'id') {
          parents.push(entry.id);
        } else if (details == 'names') {
          parents.push(entry.name);
        } else {
          logger.error('parent details (either id,names or all) to be returned not specified');
        }

        if (entry.parent) {
          entityParent = entry.parent;
          filter(entityParent, parents => callback(parents));
        } else {
          return callback(parents);
        }
      } else {
        return callback(parents);
      }
    }

    filter(entityParent, (parents) => {
      mcsd.parentCache = {};
      mcsd.parentCache.id = entityParent;
      mcsd.parentCache.details = details;
      mcsd.parentCache.parents = parents;
      // return a copy
      callback(parents.slice());
    });
  },

  getBuildingsFromData(mcsd, callback) {
    const buildings = [];
    mcsd.entry.map((entry) => {
      if (!entry.resource || !entry.resource.physicalType || !entry.resource.physicalType.coding || !Array.isArray(entry.resource.physicalType.coding)) {
        return;
      }
      const found = entry.resource.physicalType.coding.find(coding => coding.code === 'bu');
      if (found) {
        buildings.push(entry);
      }
    });
    return callback(buildings);
  },

  getBuildings(filters, callback) {
    this.getLocationChildren(filters, (locations) => {
      this.getBuildingsFromData(locations, buildings => callback(false, buildings));
    });
  },

  filterLocations(mcsd, topOrgId, levelNumber, callback) {
    const mcsdLevelNumber = {};
    mcsdLevelNumber.entry = [];
    if (!mcsd.hasOwnProperty('entry') || mcsd.entry.length == 0 || !topOrgId) {
      return callback(mcsdLevelNumber);
    }
    const entry = mcsd.entry.find(entry => entry.resource.id == topOrgId);
    if (!entry) {
      return callback(mcsdLevelNumber);
    }
    if (levelNumber == 1) {
      mcsdLevelNumber.entry = mcsdLevelNumber.entry.concat(entry);
      return callback(mcsdLevelNumber);
    }
    function filter(id, callback) {
      const res = mcsd.entry.filter((entry) => {
        if (entry.resource.hasOwnProperty('partOf')) {
          return entry.resource.partOf.reference.endsWith(id);
        }
      });
      return callback(res);
    }

    let totalLoops = 0;
    totalLoops = levelNumber;
    let tmpArr = [];
    tmpArr.push(entry);
    totalLoops = Array.from(new Array(totalLoops - 1), (val, index) => index + 1);
    async.eachSeries(totalLoops, (loop, nxtLoop) => {
      let totalElements = 0;
      const promises = [];
      tmpArr.forEach((arr) => {
        promises.push(new Promise((resolve, reject) => {
          filter(arr.resource.id, (res) => {
            tmpArr = tmpArr.concat(res);
            if (levelNumber == loop + 1) {
              mcsdLevelNumber.entry = mcsdLevelNumber.entry.concat(res);
            }
            totalElements++;
            resolve();
          });
        }));
      });
      Promise.all(promises).then(() => {
        tmpArr.splice(0, totalElements);
        return nxtLoop();
      }).catch((err) => {
        logger.error(err);
      });
    }, () => {
      callback(mcsdLevelNumber);
    });
  },

  filterLocationsSQL(rows, topOrgId, levelNumber, callback) {
    let mcsdLevelNumber = [];
    if (rows.length == 0 || !topOrgId) {
      return callback(mcsdLevelNumber);
    }
    const entry = rows.find(row => row.id == topOrgId);
    if (!entry) {
      return callback(mcsdLevelNumber);
    }
    if (levelNumber == 1) {
      mcsdLevelNumber = mcsdLevelNumber.concat(entry);
      return callback(mcsdLevelNumber);
    }
    function filter(id, callback) {
      const res = rows.filter((row) => {
        if (row.parent) {
          return row.parent === id;
        }
      });
      return callback(res);
    }

    let totalLoops = 0;
    totalLoops = levelNumber;
    let tmpArr = [];
    tmpArr.push(entry);
    totalLoops = Array.from(new Array(totalLoops - 1), (val, index) => index + 1);
    for(let loop of totalLoops) {
      let totalElements = 0;
      for(let arr of tmpArr) {
        filter(arr.id, (res) => {
          tmpArr = tmpArr.concat(res);
          if (levelNumber == loop + 1) {
            mcsdLevelNumber = mcsdLevelNumber.concat(res);
          }
          totalElements++;
        });
      }
      tmpArr.splice(0, totalElements);
    }
    callback(mcsdLevelNumber);
  },

  countLevels(db, topOrgId, callback) {
    function constructURL(id, callback) {
      const url = `${URI(fhirAxios.__genUrl(db))
        .segment('Location')}?partof=Location/${id.toString()}`;
      return callback(url);
    }

    let totalLevels = 1;
    let prev_entry = {};

    function cntLvls(url, callback) {
      const options = {
        url,
        headers: {
          'Cache-Control': 'no-cache',
        },
      };
      request.get(options, (err, res, body) => {
        if (!isJSON(body)) {
          return callback(0);
        }
        if (res.statusCode < 200 || res.statusCode > 299) {
          return callback(totalLevels);
        }
        body = JSON.parse(body);
        let entry;
        if ((body.total === 0 || (body.entry && body.entry.length === 0)) && prev_entry.length > 0) {
          entry = prev_entry.shift();
        } else if ((body.total === 0 || (body.entry && body.entry.length === 0)) && Object.keys(prev_entry).length === 0) {
          return callback(totalLevels);
        } else {
          prev_entry = [];
          prev_entry = body.entry.slice();
          entry = prev_entry.shift();
          totalLevels++;
        }
        const reference = entry.resource.id;
        constructURL(reference, (url) => {
          cntLvls(url, totalLevels => callback(totalLevels));
        });
      });
    }
    constructURL(topOrgId, (url) => {
      cntLvls(url, totalLevels => callback(false, totalLevels));
    });
  },

  editLocation(id, name, parent, db, callback) {
    this.getLocationByID(db, id, false, (location) => {
      location.entry[0].resource.name = name;
      const promise = new Promise((resolve, reject) => {
        if (parent) {
          this.getLocationByID(db, parent, false, (locationParent) => {
            location.entry[0].resource.partOf = {
              display: locationParent.entry[0].resource.name,
              reference: `Location/${locationParent.entry[0].resource.id}`,
            };
            resolve();
          });
        } else {
          delete location.entry[0].resource.partOf;
          resolve();
        }
      });
      promise.then(() => {
        const fhir = {};
        fhir.entry = [];
        fhir.type = 'batch';
        fhir.entry = fhir.entry.concat(location.entry[0]);
        this.saveLocations(fhir, db, (err, res) => {
          if (err) {
            logger.error(err);
          }
          callback(err);
        });
      });
    });
  },

  addJurisdiction({
    database,
    name,
    code,
    id,
    parent,
  }, callback) {
    const topOrgId = mixin.getTopOrgId(database);
    const resource = {};
    resource.resourceType = 'Location';
    resource.meta = {};
    resource.meta.profile = [];
    resource.meta.profile.push('http://ihe.net/fhir/StructureDefinition/IHE_mCSD_Location');
    resource.name = name;
    if (id) {
      resource.id = id;
    } else {
      resource.id = uuid4();
    }
    if (parent) {
      resource.partOf = {
        reference: `Location/${parent}`,
      };
    } else {
      resource.partOf = {
        reference: `Location/${topOrgId}`,
        display: topOrgName,
      };
    }
    if (code) {
      resource.identifier = [{
        system: 'https://digitalhealth.intrahealth.org/code',
        value: code,
      }];
    }
    resource.physicalType = {
      coding: [{
        system: 'http://hl7.org/fhir/location-physical-type',
        code: 'jdn',
        display: 'Jurisdiction',
      }],
      text: 'Jurisdiction',
    };
    const fhir = {};
    fhir.entry = [];
    fhir.type = 'batch';
    fhir.resourceType = 'Bundle';
    fhir.entry.push({
      resource,
      request: {
        method: 'PUT',
        url: `Location/${resource.id}`,
      },
    });
    this.saveLocations(fhir, database, (err, res) => {
      if (err) {
        logger.error(err);
      }
      callback(err, resource.id);
    });
  },
  addService(fields, callback) {
    async.series({
      type: (callback) => {
        const types = JSON.parse(fields.type);
        this.getCodeSystemFromCodesMinimal({
          codes: types,
          codeSystemName: 'serviceTypes',
        }, (concepts) => {
          callback(null, concepts);
        });
      },
      category: (callback) => {
        const categories = JSON.parse(fields.category);
        this.getCodeSystemFromCodesMinimal({
          codes: categories,
          codeSystemName: 'serviceCategories',
        }, concepts => callback(null, concepts));
      },
      characteristic: (callback) => {
        let characteristics;
        try {
          characteristics = JSON.parse(fields.characteristic);
        } catch (error) {
          return callback(null, null);
        }
        this.getCodeSystemFromCodesMinimal({
          codes: characteristics,
          codeSystemName: 'serviceCharacteristics',
        }, concepts => callback(null, concepts));
      },
      serviceProvisionCode: (callback) => {
        let serviceProvisionConditions;
        try {
          serviceProvisionConditions = JSON.parse(fields.serviceProvisionCode);
        } catch (error) {
          return callback(null, null);
        }
        this.getCodeSystemFromCodesMinimal({
          codes: serviceProvisionConditions,
          codeSystemName: 'serviceProvisionConditions',
        }, concepts => callback(null, concepts));
      },
      program: (callback) => {
        let programs;
        try {
          programs = JSON.parse(fields.program);
        } catch (error) {
          return callback(null, null);
        }
        this.getCodeSystemFromCodesMinimal({
          codes: programs,
          codeSystemName: 'programs',
        }, concepts => callback(null, concepts));
      },
      specialty: (callback) => {
        const specialties = JSON.parse(fields.specialty);
        this.getCodeSystemFromCodesMinimal({
          codes: specialties,
          codeSystemName: 'specialties',
        }, concepts => callback(null, concepts));
      },
      eligibility: (callback) => {
        const eligibilities = JSON.parse(fields.eligibility);
        this.getCodeSystemFromCodesMinimal({
          codes: eligibilities,
          codeSystemName: 'serviceEligibilities',
        }, concepts => callback(null, concepts));
      },
      language: (callback) => {
        const languages = JSON.parse(fields.communication);
        this.getCodeSystemFromCodesMinimal({
          codes: languages,
          codeSystemName: 'languages',
        }, concepts => callback(null, concepts));
      },
      referralMethod: (callback) => {
        const referralMethods = JSON.parse(fields.referralMethod);
        this.getCodeSystemFromCodesMinimal({
          codes: referralMethods,
          codeSystemName: 'referralMethods',
        }, concepts => callback(null, concepts));
      },
      location: (callback) => {
        const locations = JSON.parse(fields.location);
        if (Array.isArray(locations) && locations.length > 0) {
          const locationRef = locations.map(location => ({
            reference: `Location/${location}`,
          }));
          return callback(null, locationRef);
        }
        return callback(null);
      },
    }, (err, response) => {
      const resource = {};
      resource.resourceType = 'HealthcareService';
      if (fields.id) {
        resource.id = fields.id;
      } else {
        resource.id = uuid4();
      }
      resource.name = fields.name;
      if (fields.code) {
        resource.identifier = [{
          system: 'https://digitalhealth.intrahealth.org/code',
          value: fields.code,
        }];
      }
      resource.active = JSON.parse(fields.active);
      resource.appointmentRequired = JSON.parse(fields.appointmentRequired);
      if (JSON.parse(fields.category).length > 0) {
        const codeSystemURI = mixin.getCodesysteURI('serviceCategories');
        const codeableConcept = mixin.createCodeableConcept(response.category, codeSystemURI.uri);
        resource.category = codeableConcept;
      }
      if (JSON.parse(fields.type).length > 0) {
        const codeSystemURI = mixin.getCodesysteURI('serviceTypes');
        const codeableConcept = mixin.createCodeableConcept(response.type, codeSystemURI.uri);
        resource.type = codeableConcept;
      }
      if (JSON.parse(fields.characteristic).length > 0) {
        const codeSystemURI = mixin.getCodesysteURI('serviceCharacteristics');
        const codeableConcept = mixin.createCodeableConcept(response.characteristic, codeSystemURI.uri);
        resource.characteristic = codeableConcept;
      }
      if (JSON.parse(fields.program).length > 0) {
        const codeSystemURI = mixin.getCodesysteURI('programs');
        const codeableConcept = mixin.createCodeableConcept(response.program, codeSystemURI.uri);
        resource.program = codeableConcept;
      }
      if (JSON.parse(fields.specialty).length > 0) {
        const codeSystemURI = mixin.getCodesysteURI('specialties');
        const codeableConcept = mixin.createCodeableConcept(response.specialty, codeSystemURI.uri);
        resource.specialty = codeableConcept;
      }
      if (JSON.parse(fields.eligibility).length > 0) {
        resource.eligibility = [];
        const codeSystemURI = mixin.getCodesysteURI('serviceEligibilities');
        const codeableConcept = mixin.createCodeableConcept(response.eligibility, codeSystemURI.uri);
        codeableConcept.forEach((codeable) => {
          resource.eligibility.push({
            code: codeable,
          });
        });
      }
      if (JSON.parse(fields.communication).length > 0) {
        const codeSystemURI = mixin.getCodesysteURI('languages');
        const codeableConcept = mixin.createCodeableConcept(response.language, codeSystemURI.uri);
        resource.communication = codeableConcept;
      }
      if (JSON.parse(fields.referralMethod).length > 0) {
        const codeSystemURI = mixin.getCodesysteURI('referralMethods');
        const codeableConcept = mixin.createCodeableConcept(response.referralMethod, codeSystemURI.uri);
        resource.referralMethod = codeableConcept;
      }
      if (JSON.parse(fields.serviceProvisionCode).length > 0) {
        const codeSystemURI = mixin.getCodesysteURI('serviceProvisionConditions');
        const codeableConcept = mixin.createCodeableConcept(response.serviceProvisionCode, codeSystemURI.uri);
        resource.serviceProvisionCode = codeableConcept;
      }
      if (JSON.parse(fields.location).length > 0) {
        resource.location = response.location;
      }
      if (fields.comment) {
        resource.comment = fields.comment;
      }
      if (fields.extraDetails) {
        resource.extraDetails = fields.extraDetails;
      }
      if (fields.photo) {
        resource.photo = fields.photo;
      }
      try {
        const telecom = JSON.parse(fields.telecom);
        resource.telecom = [];
        if (telecom.phone) {
          resource.telecom.push({
            system: 'phone',
            value: telecom.phone,
          });
        }
        if (telecom.email) {
          resource.telecom.push({
            system: 'email',
            value: telecom.email,
          });
        }
        if (telecom.fax) {
          resource.telecom.push({
            system: 'fax',
            value: telecom.fax,
          });
        }
        if (telecom.website) {
          resource.telecom.push({
            system: 'url',
            value: telecom.website,
          });
        }
      } catch (error) {
        logger.error(error);
      }
      if (resource.telecom.length === 0) {
        delete resource.telecom;
      }
      const availableTime = JSON.parse(fields.availableTime);
      resource.availableTime = [];
      availableTime.forEach((avTime) => {
        const time = {};
        let addThis = false;
        if (avTime.mainFields.daysOfWeek.length > 0) {
          time.daysOfWeek = avTime.mainFields.daysOfWeek;
          addThis = true;
        }
        time.allDay = avTime.mainFields.allDay;
        if (avTime.mainFields.availableStartTime && !avTime.mainFields.allDay) {
          time.availableStartTime = avTime.mainFields.availableStartTime;
          addThis = true;
        }
        if (avTime.mainFields.availableEndTime && !avTime.mainFields.allDay) {
          time.availableEndTime = avTime.mainFields.availableEndTime;
          addThis = true;
        }
        if (addThis) {
          resource.availableTime.push(time);
        }
      });
      if (resource.availableTime.length === 0) {
        delete resource.availableTime;
      }
      const notAvailable = JSON.parse(fields.notAvailable);
      resource.notAvailable = [];
      notAvailable.forEach((notAv) => {
        const notAvDet = {};
        notAvDet.description = notAv.mainFields.description;
        if (notAvDet.description) {
          if (notAv.mainFields.during && notAv.mainFields.during.start) {
            notAvDet.during = {};
            notAvDet.during.start = notAv.mainFields.during.start;
          }
          if (notAv.mainFields.during && notAv.mainFields.during.end) {
            notAvDet.during.end = notAv.mainFields.during.end;
          }
          resource.notAvailable.push(notAvDet);
        }
      });
      const fhir = {};
      fhir.entry = [];
      fhir.type = 'batch';
      fhir.resourceType = 'Bundle';
      fhir.entry.push({
        resource,
        request: {
          method: 'PUT',
          url: `HealthcareService/${resource.id}`,
        },
      });
      this.saveLocations(fhir, '', (err, res) => {
        if (err) {
          logger.error(err);
        }
        callback(err);
      });
    });
  },

  changeBuildingRequestStatus({
    id,
    status,
    requestType,
  }, callback) {
    const database = config.get('mCSD:requestsDB');
    this.getLocationByID(database, id, true, (location) => {
      if (!location || !location.entry || location.entry.length === 0) {
        logger.error(`No location with id ${id} found`);
        return callback(`No location with id ${id} found`);
      }
      const requestLocationResource = location.entry.find(entry => entry.resource.resourceType === 'Location');
      const requestOrganizationResource = location.entry.find(entry => entry.resource.resourceType === 'Organization');
      if (!requestLocationResource) {
        logger.error(`No location resource with id ${id} found`);
        return callback(`No location resource with id ${id} found`);
      }
      const requestExtension = mixin.getLatestFacilityRequest(requestLocationResource.resource.extension, requestType);
      if (!requestExtension || !Array.isArray(requestExtension)) {
        logger.error('Request extension cant be found, stop changing status');
        return callback(true);
      }
      for (const i in requestExtension) {
        if (requestExtension[i].url === 'status') {
          requestExtension[i].valueString = status;
        }
      }

      const copyRequestLocationResource = lodash.cloneDeep(requestLocationResource);
      const copyRequestOrganizationResource = lodash.cloneDeep(requestOrganizationResource);

      const registryBundle = {};
      const requestsBundle = {};
      registryBundle.entry = [];
      requestsBundle.entry = [];
      registryBundle.type = 'batch';
      requestsBundle.type = 'batch';
      registryBundle.resourceType = 'Bundle';
      requestsBundle.resourceType = 'Bundle';

      let requestURI;
      const facilityUpdateRequestURI = mixin.getCodesysteURI('facilityUpdateRequest');
      const facilityAddRequestURI = mixin.getCodesysteURI('facilityAddRequest');
      if (requestType === 'add' && status === 'approved') {
        requestURI = facilityAddRequestURI.uri;
      } else if (requestType === 'update') {
        requestURI = facilityUpdateRequestURI.uri;
      }

      if (status === 'approved' && requestType === 'update') {
        let updatingResourceID;
        const ext = requestLocationResource.resource.extension && requestLocationResource.resource.extension.find(extension => extension.url === requestURI);
        if (ext) {
          const valRef = ext.extension.find(extension => extension.url === 'registryResourceId');
          if (valRef) {
            updatingResourceID = valRef.valueReference.reference.split('/').pop();
          }
        }
        if (updatingResourceID) {
          this.getLocationByID('', updatingResourceID, true, (regLoc) => {
            if (!regLoc || !regLoc.entry || regLoc.entry.length === 0) {
              logger.error(`No location with id ${updatingResourceID} found`);
              return callback(`No location with id ${updatingResourceID} found`);
            }
            const registryLocationResource = regLoc.entry.find(entry => entry.resource.resourceType === 'Location');
            const registryOganizationResource = regLoc.entry.find(entry => entry.resource.resourceType === 'Organization');
            const registryLocationId = registryLocationResource.resource.id;
            const registryLocationOrg = lodash.cloneDeep(registryLocationResource.resource.managingOrganization);
            const registryOrganizationId = registryOganizationResource.resource.id;
            Object.assign(registryLocationResource.resource, copyRequestLocationResource.resource);
            Object.assign(registryOganizationResource.resource, copyRequestOrganizationResource.resource);
            registryLocationResource.resource.id = registryLocationId;
            registryLocationResource.resource.managingOrganization = registryLocationOrg;
            if (registryOganizationResource && registryOganizationResource.resource) {
              registryOganizationResource.resource.id = registryOrganizationId;
            }
            // remove request extension
            for (const i in registryLocationResource.resource.extension) {
              if (registryLocationResource.resource.extension[i].url === requestURI) {
                registryLocationResource.resource.extension.splice(i, 1);
              }
            }
            if (registryOganizationResource) {
              registryBundle.entry.push({
                resource: registryOganizationResource.resource,
                request: {
                  method: 'PUT',
                  url: `Organization/${registryOganizationResource.resource.id}`,
                },
              });
            }
            registryBundle.entry.push({
              resource: registryLocationResource.resource,
              request: {
                method: 'PUT',
                url: `Location/${registryLocationResource.resource.id}`,
              },
            });
            requestsBundle.entry.push({
              resource: requestLocationResource.resource,
              request: {
                method: 'PUT',
                url: `Location/${requestLocationResource.resource.id}`,
              },
            });
            async.parallel({
              updateRegistry: (callback) => {
                this.saveLocations(registryBundle, '', (err, res) => {
                  if (err) {
                    logger.error(err);
                    return callback(err);
                  }
                  return callback(null);
                });
              },
              updateRequests: (callback) => {
                this.saveLocations(requestsBundle, database, (err, res) => {
                  if (err) {
                    logger.error(err);
                    return callback(err);
                  }
                  return callback(null);
                });
              },
            }, (err) => {
              if (err) {
                return callback(err);
              }
              return callback();
            });
          });
        } else {
          return callback(true);
        }
      } else if (status === 'approved' && requestType === 'add') {
        copyRequestLocationResource.resource.id = uuid4();
        if (copyRequestOrganizationResource) {
          copyRequestOrganizationResource.resource.id = uuid4();
          copyRequestLocationResource.resource.managingOrganization = {
            reference: `Organization/${copyRequestOrganizationResource.resource.id}`,
          };
        }
        // remove request extension
        for (const i in copyRequestLocationResource.resource.extension) {
          if (copyRequestLocationResource.resource.extension[i].url === requestURI) {
            copyRequestLocationResource.resource.extension.splice(i, 1);
          }
        }
        // link the Location to be created into the registry with the requesting resource
        for (const i in requestLocationResource.resource.extension) {
          if (requestLocationResource.resource.extension[i].url === requestURI) {
            requestLocationResource.resource.extension[i].extension.push({
              url: 'registryResourceId',
              valueReference: {
                reference: `Location/${copyRequestLocationResource.resource.id}`,
              },
            });
          }
        }
        if (copyRequestOrganizationResource) {
          registryBundle.entry.push({
            resource: copyRequestOrganizationResource.resource,
            request: {
              method: 'PUT',
              url: `Organization/${copyRequestOrganizationResource.resource.id}`,
            },
          });
        }
        registryBundle.entry.push({
          resource: copyRequestLocationResource.resource,
          request: {
            method: 'PUT',
            url: `Location/${copyRequestLocationResource.resource.id}`,
          },
        });
        requestsBundle.entry.push({
          resource: requestLocationResource.resource,
          request: {
            method: 'PUT',
            url: `Location/${requestLocationResource.resource.id}`,
          },
        });
        async.parallel({
          updateRegistry: (callback) => {
            this.saveLocations(registryBundle, '', (err, res) => {
              if (err) {
                logger.error(err);
                return callback(err);
              }
              return callback(null);
            });
          },
          updateRequests: (callback) => {
            this.saveLocations(requestsBundle, database, (err, res) => {
              if (err) {
                logger.error(err);
                return callback(err);
              }
              return callback(null);
            });
          },
        }, (err) => {
          if (err) {
            return callback(err);
          }
          return callback();
        });
      } else {
        requestsBundle.entry.push({
          resource: requestLocationResource.resource,
          request: {
            method: 'PUT',
            url: `Location/${requestLocationResource.resource.id}`,
          },
        });
        this.saveLocations(requestsBundle, database, (err, res) => {
          if (err) {
            logger.error(err);
            return callback(err);
          }
          return callback(null);
        });
      }
    });
  },

  addCodeSystem({
    name,
    text,
    code,
    codeSystemType,
  }, callback) {
    const codeSyst = mixin.getCodesysteURI(codeSystemType);
    if (!codeSyst) {
      logger.error(`Code system type ${codeSystemType} not found on the config file`);
      return callback(true);
    }
    const codeSystemURI = codeSyst.uri;
    this.getCodeSystem({
      codeSystemURI,
    }, (codeSystem) => {
      let codeSystemResource = {};
      if (codeSystem.entry.length > 0) {
        codeSystemResource = codeSystem.entry[0].resource;
        codeSystemResource.date = moment().format('YYYY-MM-DDTHH:mm:ssZ');
        codeSystemResource.concept.push({
          code,
          display: name,
        });
      } else {
        codeSystemResource.resourceType = 'CodeSystem';
        codeSystemResource.id = uuid4();
        codeSystemResource.url = codeSystemURI;
        codeSystemResource.status = 'active';
        codeSystemResource.content = 'complete';
        codeSystemResource.caseSensitive = true;
        codeSystemResource.date = moment().format('YYYY-MM-DDTHH:mm:ssZ');
        codeSystemResource.version = '1.0.0';
        codeSystemResource.concept = [];
        codeSystemResource.concept.push({
          code,
          display: name,
        });
      }
      const fhir = {};
      fhir.entry = [];
      fhir.type = 'batch';
      fhir.resourceType = 'Bundle';
      fhir.entry.push({
        resource: codeSystemResource,
        request: {
          method: 'PUT',
          url: `CodeSystem/${codeSystemResource.id}`,
        },
      });
      this.saveLocations(fhir, '', (err, res) => {
        if (err) {
          logger.error(err);
        }
        callback(err);
      });
    });
  },

  deleteResource({
    database,
    resource,
    id,
  }, callback) {
    if (!database) {
      database = config.get('mCSD:registryDB');
    }
    const urlPrefix = URI(fhirAxios.__genUrl(database))
      .segment(resource);
    const url = URI(urlPrefix).segment(id).toString();
    const options = {
      url,
    };
    request.delete(options, (err, res, body) => {
      this.cleanCache(`url_${urlPrefix.toString()}`, true);
      this.cleanCache('parents', true);
      if (err) {
        logger.error(err);
        return callback(err);
      }
      return callback();
    });
  },

  createFakeOrgID(database) {
    return new Promise((resolve, reject) => {
      const locTopOrgId = mixin.getTopOrgId(database, 'Location');
      const orgTopOrgId = mixin.getTopOrgId(database, 'Organization');
      let createLoc = false;
      let createOrg = false;
      const fhirDoc = {};
      fhirDoc.entry = [];
      fhirDoc.type = 'batch';
      fhirDoc.resourceType = 'Bundle';
      async.parallel({
        loc: (callback) => {
          this.getLocationByID(database, locTopOrgId, false, (results) => {
            if (results.entry.length === 0) {
              createLoc = true;
            }
            return callback(null);
          });
        },
        org: (callback) => {
          this.getOrganizationByID({
            id: orgTopOrgId,
            database,
          }, (orgDt) => {
            if (orgDt.entry.length === 0) {
              createOrg = true;
            }
            return callback(null);
          });
        },
      }, () => {
        if (createLoc) {
          const resource = {};
          resource.resourceType = 'Location';
          resource.name = topOrgName;
          resource.id = locTopOrgId;
          resource.identifier = [{
            system: 'https://digitalhealth.intrahealth.org/id',
            value: locTopOrgId,
          }];
          resource.physicalType = {
            coding: [{
              system: 'http://hl7.org/fhir/location-physical-type',
              code: 'jdn',
              display: 'Jurisdiction',
            }],
            text: 'Jurisdiction',
          };
          fhirDoc.entry.push({
            resource,
            request: {
              method: 'PUT',
              url: `Location/${locTopOrgId}`,
            },
          });
        }

        if (createOrg) {
          const resource = {};
          resource.resourceType = 'Organization';
          resource.name = topOrgName;
          resource.id = orgTopOrgId;
          resource.identifier = [{
            system: 'https://digitalhealth.intrahealth.org/id',
            value: orgTopOrgId,
          }];
          fhirDoc.entry.push({
            resource,
            request: {
              method: 'PUT',
              url: `Organization/${orgTopOrgId}`,
            },
          });
        }

        if (fhirDoc.entry.length > 0) {
          this.saveLocations(fhirDoc, database, (err) => {
            if (err) {
              reject(err);
            } else {
              logger.info('Fake Org Id Created Successfully');
              resolve();
            }
          });
        } else {
          return resolve();
        }
      });
    });
  },
  saveLocations(mCSD, database, callback) {
    if (!database) {
      database = config.get('mCSD:registryDB');
    }
    let url = URI(fhirAxios.__genUrl());
    if (database) {
      url = url.segment(database);
    }
    url = url.toString();
    const options = {
      url,
      headers: {
        'Content-Type': 'application/json',
      },
      json: mCSD,
    };
    request.post(options, (err, res, body) => {
      if (res?.statusCode === 404) {
        logger.error(body);
        logger.error('Looks like the mapping DB does not exist, cant save this location');
        return callback('Failed to save', null);
      }
      if (err) {
        logger.error(err);
        return callback(err);
      }
      this.cleanCache(`url_${url}/Location`, true);
      this.cleanCache('parents', true);
      callback(err, body);
    });
  },
  saveLocationsPromise(mCSD, database) {
    return new Promise((resolve, reject) => {
      if (!database) {
        database = config.get('mCSD:registryDB');
      }
      let url = URI(fhirAxios.__genUrl());
      if (database) {
        url = url.segment(database);
      }
      url = url.toString();
      const options = {
        url,
        headers: {
          'Content-Type': 'application/json',
        },
        json: mCSD,
      };
      request.post(options, (err, res, body) => {
        if (res.statusCode === 404) {
          logger.error(body);
          logger.error('Looks like the mapping DB does not exist, cant save this location');
          return resolve('Failed to save', null);
        }
        if (err) {
          logger.error(err);
          return resolve(err);
        }
        this.cleanCache(`url_${url}/Location`, true);
        this.cleanCache('parents', true);
        resolve(body);
      });
    })
  },
  cleanCache(key, isPrefix) {
    if (isPrefix) {
      redisClient.keys(`${key}*`, (err, keys) => {
        for (const key1 of keys) {
          redisClient.DEL(key1, (err, res) => {
            logger.info(`DELETING ${key1} from cache because something was modified.`);
          });
        }
      });
    } else {
      redisClient.DEL(key, () => {
        logger.info(`DELETING ${key} from cache because something was modified.`);
      });
    }
  },
  saveMatch(source1Id, source2Id, source1DB, source2DB, mappingDB, recoLevel, totalLevels, type, autoMatch, flagComment, callback) {
    const flagCode = config.get('mapping:flagCode');
    const autoMatchedCode = config.get('mapping:autoMatchedCode');
    const manualllyMatchedCode = config.get('mapping:manualllyMatchedCode');
    const matchCommentsCode = config.get('mapping:matchCommentsCode');
    const flagCommentCode = config.get('mapping:flagCommentCode');
    const src1FakeOrgId = mixin.getTopOrgId(source1DB, 'Location');
    const src2FakeOrgId = mixin.getTopOrgId(source2DB, 'Location');
    const mappingFakeOrgId = mixin.getTopOrgId(mappingDB, 'Location');
    const source1System = 'https://digitalhealth.intrahealth.org/source1';
    const source2System = 'https://digitalhealth.intrahealth.org/source2';
    // check if its already mapped and ignore

    const me = this;
    async.parallel({
      source2Mapped(callback) {
        const source2Identifier = URI(fhirAxios.__genUrl(source2DB))
          .segment('Location')
          .segment(source2Id)
          .toString();
        me.getLocationByIdentifier(mappingDB, source2Identifier, (mapped) => {
          if (mapped.entry.length > 0) {
            logger.error('Attempting to map already mapped location');
            return callback(null, 'This location was already mapped, recalculate scores to update the level you are working on');
          }
          return callback(null, null);
        });
      },
      source1Mapped(callback) {
        me.getLocationByID(mappingDB, source1Id, false, (mapped) => {
          if (mapped.entry.length > 0) {
            logger.error('Attempting to map already mapped location');
            return callback(null, 'This location was already mapped, recalculate scores to update the level you are working on');
          }
          return callback(null, null);
        });
      },
      source1mCSD(callback) {
        me.getLocationByID(source1DB, source1Id, false, mcsd => callback(null, mcsd));
      },
      source2mCSD(callback) {
        me.getLocationByID(source2DB, source2Id, false, mcsd => callback(null, mcsd));
      },
      source1Parents(callback) {
        me.getLocationParentsFromDB(source1DB, source1Id, src1FakeOrgId, 'id', parents => callback(null, parents));
      },
      source2Parents(callback) {
        me.getLocationParentsFromDB(source2DB, source2Id, src2FakeOrgId, 'id', parents => callback(null, parents));
      },
    }, (err, res) => {
      if (!res.source2mCSD || !res.source2mCSD.entry || res.source2mCSD.entry.length === 0) {
        return callback(true, false);
      }
      if (!res.source1mCSD || !res.source1mCSD.entry || res.source1mCSD.entry.length === 0) {
        return callback(true, false);
      }
      if (res.source1Mapped !== null) {
        return callback(res.source1Mapped);
      }
      if (res.source2Mapped !== null) {
        return callback(res.source2Mapped);
      }

      if (Array.isArray(res.source1Parents)) {
        res.source1Parents.splice(0, 1);
      }
      if (Array.isArray(res.source2Parents)) {
        res.source2Parents.splice(0, 1);
      }

      this.getLocationByID(mappingDB, res.source1Parents[0], false, (mapped1) => {
        if (!isJSON(JSON.stringify(mapped1))) {
          logger.error(`Non JSON results returned ${JSON.stringify(mapped1)}`);
          return callback(true, false);
        }
        if (mapped1.entry.length > 0) {
          res.source1Parents[0] = mixin.getIdFromIdentifiers(mapped1.entry[0].resource.identifier, 'https://digitalhealth.intrahealth.org/source2');
        }
        // Handle match comments
        const matchComments = [];
        if (!res.source2Parents.includes(res.source1Parents[0])) {
          matchComments.push('Parents differ');
        }
        const source1Name = res.source2mCSD.entry[0].resource.name;
        const source2Name = res.source1mCSD.entry[0].resource.name;
        const lev = levenshtein.get(source2Name.toLowerCase(), source1Name.toLowerCase());
        if (lev !== 0) {
          matchComments.push('Names differ');
        }
        if (recoLevel == totalLevels) {
          const idEqual = mixin.haveIdInCommon(res.source1mCSD.entry[0].resource.identifier, res.source2mCSD.entry[0].resource.identifier);
          if (!idEqual) {
            matchComments.push('ID differ');
          }
          let source2Latitude = null;
          let source2Longitude = null;
          let source1Latitude = null;
          let source1Longitude = null;
          if (res.source1mCSD.entry[0].resource.hasOwnProperty('position')) {
            source2Latitude = res.source1mCSD.entry[0].resource.position.latitude;
            source2Longitude = res.source1mCSD.entry[0].resource.position.longitude;
          }
          if (res.source2mCSD.entry[0].resource.hasOwnProperty('position')) {
            source1Latitude = res.source2mCSD.entry[0].resource.position.latitude;
            source1Longitude = res.source2mCSD.entry[0].resource.position.longitude;
          }
          if (source2Latitude && source2Longitude) {
            const dist = geodist({
              source2Latitude,
              source2Longitude,
            }, {
              source1Latitude,
              source1Longitude,
            }, {
              exact: false,
              unit: 'miles',
            });
            if (dist !== 0) {
              matchComments.push('Coordinates differ');
            }
          } else {
            matchComments.push('Coordinates missing');
          }
        }
        // End of handling match comments

        const fhir = {};
        fhir.entry = [];
        fhir.type = 'batch';
        fhir.resourceType = 'Bundle';
        const entry = [];
        const resource = jsonmerger.mergeObjects([res.source2mCSD.entry[0].resource, res.source1mCSD.entry[0].resource]);
        resource.alias = res.source2mCSD.entry[0].resource.name; // take source1 name
        resource.id = mixin.getMappingId(source1Id);
        resource.identifier = [];
        const source2URL = URI(fhirAxios.__genUrl(source2DB)).segment('Location')
          .segment(source2Id)
          .toString();
        const source1URL = URI(fhirAxios.__genUrl(source1DB)).segment('Location')
          .segment(source1Id)
          .toString();
        resource.identifier.push({
          system: source2System,
          value: source2URL,
        });
        resource.identifier.push({
          system: source1System,
          value: source1URL,
        });
        if (res.source1mCSD.entry[0].resource.hasOwnProperty('partOf')) {
          if (res.source1mCSD.entry[0].resource.partOf.reference.split('/')[1] === src1FakeOrgId) {
            resource.partOf = {
              display: res.source1mCSD.entry[0].resource.partOf.display,
              reference: `Location/${mappingFakeOrgId}`,
            };
          } else {
            const id = res.source1mCSD.entry[0].resource.partOf.reference.split('/')[1];
            resource.partOf = {
              display: res.source1mCSD.entry[0].resource.partOf.display,
              reference: `Location/${mixin.getMappingId(id)}`,
            };
          }
        }
        if (!resource.meta) {
          resource.meta = {};
        }
        if (!resource.meta.tag) {
          resource.meta.tag = [];
        }
        if (matchComments.length > 0) {
          resource.meta.tag.push({
            system: source2System,
            code: matchCommentsCode,
            display: matchComments,
          });
        }
        if (type == 'flag') {
          if (flagComment) {
            resource.meta.tag.push({
              system: source2System,
              code: flagCommentCode,
              display: flagComment,
            });
          }
          resource.meta.tag.push({
            system: source2System,
            code: flagCode,
            display: 'To be reviewed',
          });
        }
        if (autoMatch) {
          resource.meta.tag.push({
            system: source2System,
            code: autoMatchedCode,
            display: 'Automatically Matched',
          });
        } else {
          resource.meta.tag.push({
            system: source2System,
            code: manualllyMatchedCode,
            display: 'Manually Matched',
          });
        }
        entry.push({
          resource,
          request: {
            method: 'PUT',
            url: `Location/${resource.id}`,
          },
        });
        fhir.entry = fhir.entry.concat(entry);
        me.saveLocations(fhir, mappingDB, (err, res) => {
          const url_prefix = URI(fhirAxios.__genUrl(mappingDB)).segment('Location');
          this.cleanCache(`url_${url_prefix.toString()}`, true);
          this.cleanCache(`parents${recoLevel}${source2DB}`);
          if (err) {
            logger.error(err);
          }
          callback(err, matchComments);
        });
      });
    });
  },
  acceptFlag(source1Id, mappingDB, callback) {
    const mappingId = mixin.getMappingId(source1Id);
    this.getLocationByID(mappingDB, mappingId, false, (flagged) => {
      delete flagged.id;
      delete flagged.meta;
      delete flagged.total;
      delete flagged.link;
      const flagCode = config.get('mapping:flagCode');
      const flagCommentCode = config.get('mapping:flagCommentCode');
      // remove the flag tag
      for (const k in flagged.entry[0].resource.meta.tag) {
        const tag = flagged.entry[0].resource.meta.tag[k];
        if (tag.code === flagCode) {
          flagged.entry[0].resource.meta.tag.splice(k, 1);
        }
      }

      for (const k in flagged.entry[0].resource.meta.tag) {
        const tag = flagged.entry[0].resource.meta.tag[k];
        if (tag.code === flagCommentCode) {
          flagged.entry[0].resource.meta.tag.splice(k, 1);
        }
      }
      flagged.entry[0].request = {};
      flagged.entry[0].request.method = 'PUT';
      flagged.entry[0].request.url = `Location/${flagged.entry[0].resource.id}`;
      flagged.resourceType = 'Bundle';
      flagged.type = 'batch';

      // deleting existing location
      const url_prefix = URI(fhirAxios.__genUrl(mappingDB)).segment('Location');
      const url = URI(url_prefix).segment(mappingId).toString();
      const options = {
        url,
      };
      request.delete(options, (err, res, body) => {
        this.cleanCache(`url_${url_prefix.toString()}`, true);
        this.cleanCache('parents', true);
        if (err) {
          logger.error(err);
          return callback(err);
        }
        // saving new
        this.saveLocations(flagged, mappingDB, (err, res) => {
          if (err) {
            logger.error(err);
          }
          return callback(err);
        });
      });
    });
  },
  saveNoMatch(source1Id, source1DB, source2DB, mappingDB, recoLevel, totalLevels, type, callback) {
    const source1System = 'https://digitalhealth.intrahealth.org/source1';
    const noMatchCode = config.get('mapping:noMatchCode');
    const ignoreCode = config.get('mapping:ignoreCode');
    const src1FakeOrgId = mixin.getTopOrgId(source1DB, 'Location');
    const mappingFakeOrgId = mixin.getTopOrgId(mappingDB, 'Location');
    const mappingId = mixin.getMappingId(source1Id);
    const me = this;
    async.parallel({
      source1Mapped(callback) {
        me.getLocationByID(mappingDB, mappingId, false, (mapped) => {
          if (mapped.entry.length > 0) {
            logger.error('Attempting to mark an already mapped location as no match');
            return callback(null, 'This location was already mapped, recalculate scores to update the level you are working on');
          }
          return callback(null, null);
        });
      },
    },
    (err, res) => {
      if (res.source1Mapped !== null) {
        return callback(res.source1Mapped);
      }
      me.getLocationByID(source1DB, source1Id, false, (mcsd) => {
        if (mcsd.entry.length === 0) {
          logger.error(`Location with ID ${source1Id} not found on the mCSD DB, this isnt expected, please cross check`);
          return callback(true);
        }
        const fhir = {};
        fhir.entry = [];
        fhir.type = 'batch';
        fhir.resourceType = 'Bundle';
        const entry = [];
        const resource = {};
        resource.resourceType = 'Location';
        resource.name = mcsd.entry[0].resource.name;
        resource.id = mappingId;

        if (mcsd.entry[0].resource.hasOwnProperty('partOf')) {
          if (mcsd.entry[0].resource.partOf.reference.split('/')[1] === src1FakeOrgId) {
            resource.partOf = {
              display: mcsd.entry[0].resource.partOf.display,
              reference: `Location/${mappingFakeOrgId}`,
            };
          } else {
            const id = mcsd.entry[0].resource.partOf.reference.split('/')[1];
            resource.partOf = {
              display: mcsd.entry[0].resource.partOf.display,
              reference: `Location/${mixin.getMappingId(id)}`,
            };
          }
        }
        let typeCode;
        let typeName;
        if (recoLevel == totalLevels) {
          typeCode = 'bu';
          typeName = 'building';
        } else {
          typeCode = 'jdn';
          typeName = 'Jurisdiction';
        }
        resource.physicalType = {
          coding: [{
            code: typeCode,
            display: typeName,
            system: 'http://hl7.org/fhir/location-physical-type',
          }],
        };
        resource.identifier = [];
        const url_prefix = URI(fhirAxios.__genUrl(source1DB)).segment('Location');
        const source1URL = URI(url_prefix).segment(source1Id).toString();
        resource.identifier.push({
          system: source1System,
          value: source1URL,
        });
        resource.meta = {};
        resource.meta.tag = [];
        if (type == 'nomatch') {
          resource.meta.tag.push({
            system: source1System,
            code: noMatchCode,
            display: 'No Match',
          });
        } else if (type == 'ignore') {
          resource.meta.tag.push({
            system: source1System,
            code: ignoreCode,
            display: 'Ignore',
          });
        }
        entry.push({
          resource,
          request: {
            method: 'PUT',
            url: `Location/${resource.id}`,
          },
        });
        fhir.entry = fhir.entry.concat(entry);
        me.saveLocations(fhir, mappingDB, (err, res) => {
          this.cleanCache(`url_${url_prefix.toString()}`, true);
          if (err) {
            logger.error(err);
          }
          callback(err);
        });
      });
    });
  },
  breakMatch(source1Id, mappingDB, source1DB, callback) {
    if (!source1Id) {
      return callback(true, false);
    }
    const url_prefix = URI(fhirAxios.__genUrl(mappingDB))
      .segment('Location');
    const source1UrlPrefix = URI(fhirAxios.__genUrl(source1DB))
      .segment('Location');
    const mappingId = mixin.getMappingId(source1Id);
    const url = URI(url_prefix).segment(mappingId).toString();
    const options = {
      url,
    };
    this.getLocationByID(source1DB, source1Id, false, (location) => {
      if (location.entry.length === 0) {
        return callback(true, null);
      }
      request.delete(options, (err, res, body) => {
        this.cleanCache(`url_${url_prefix.toString()}`, true);
        this.cleanCache(`url_${source1UrlPrefix.toString()}`, true);
        this.cleanCache('parents', true);
        if (res.statusCode === 409) {
          return callback('Can not break this match as there are other matches that are child of this', null);
        }
        if (err) {
          return callback('Un expected error has occured, match was not broken', null);
        }
        delete location.resourceType;
        delete location.id;
        delete location.meta;
        delete location.total;
        delete location.link;
        const matchBrokenCode = config.get('mapping:matchBrokenCode');
        // remove the flag tag
        let found = false;
        async.eachSeries(location.entry[0].resource.meta.tag, (tag, nxtTag) => {
          if (tag.code === matchBrokenCode) {
            found = true;
          }
          return nxtTag();
        }, () => {
          location.resourceType = 'Bundle';
          location.type = 'batch';
          if (!found) {
            const source1System = 'https://digitalhealth.intrahealth.org/source1';
            if (!location.entry[0].resource.meta) {
              location.entry[0].resource.meta = {};
            }
            if (!location.entry[0].resource.meta.tag) {
              location.entry[0].resource.meta.tag = [];
            }
            location.entry[0].resource.meta.tag.push({
              system: source1System,
              code: matchBrokenCode,
              display: 'Match Broken',
            });
            location.entry[0].request = {};
            location.entry[0].request.method = 'PUT';
            location.entry[0].request.url = `Location/${location.entry[0].resource.id}`;
            this.saveLocations(location, source1DB, (err, res) => {
              this.addTagInSql(source1DB, source1Id, matchBrokenCode)
              callback(err, null);
            });
          } else {
            callback(err, null);
          }
        });
      });
    });
  },
  breakNoMatch(source1Id, mappingDB, callback) {
    const mappingId = mixin.getMappingId(source1Id);
    const url_prefix = URI(fhirAxios.__genUrl(mappingDB))
      .segment('Location');
    const url = URI(url_prefix)
      .segment(mappingId)
      .toString();
    const options = {
      url,
    };
    request.delete(options, (err, res, body) => {
      this.cleanCache(`url_${url_prefix.toString()}`, true);
      if (err) {
        logger.error(err);
      }
      callback(err);
    });
  },
  addTagInSql(db, id, tagCode) {
    return new Promise((resolve, reject) => {
      pool.query(`select * from ${db} where id='${id}'`).then((response) => {
        if(response.rows.length > 0) {
          let location = response.rows[0]
          if(!location.tag) {
            location.tag = []
          } else if(typeof location.tag === 'string') {
            location.tag = JSON.parse(location.tag)
          }
          let exist = location.tag.find((tag) => {
            return tag === tagCode
          })
          if(!exist) {
            location.tag.push(tagCode)
          }
          location.tag = JSON.stringify(location.tag)
          pool.query(`update ${db} set tag='${location.tag}' where id='${id}'`).then(() => {
            resolve()
          }).catch((err) => {
            logger.error(err);
            reject()
          })
        } else {
          return resolve()
        }
      }).catch((err) => {
        logger.error(err);
        return reject()
      })
    })
  },
  removeTagInSql(db, id, tagCode) {
    return new Promise((resolve, reject) => {
      pool.query(`select * from ${db} where id='${id}'`).then((response) => {
        if(response.rows.length > 0) {
          let location = response.rows[0]
          if(!location.tag) {
            return resolve()
          } else if(typeof location.tag === 'string') {
            location.tag = JSON.parse(location.tag)
          }
          let tagIndex = location.tag.findIndex((tag) => {
            return tag === tagCode
          })
          if(tagIndex == -1) {
            return resolve()
          }
          location.tag.splice(tagIndex, 1)
          location.tag = JSON.stringify(location.tag)
          pool.query(`update ${db} set tag='${location.tag}' where id='${id}'`).then(() => {
            resolve()
          }).catch((err) => {
            logger.error(err);
            reject()
          })
        } else {
          return resolve()
        }
      }).catch((err) => {
        logger.error(err);
        return reject()
      })
    })
  },
  async CSVTomCSD(filePath, headerMapping, database, clientId, callback) {
    await uploadToSql.createTable(database)
    const uploadRequestId = `uploadProgress${clientId}`;
    const namespace = config.get('UUID:namespace');
    const levels = config.get('levels');
    levels.sort((a, b) => parseInt(a.replace('level', '')) - parseInt(b.replace('level', '')));
    const topOrgId = mixin.getTopOrgId(database, 'Location');
    const orgname = config.get('mCSD:fakeOrgName');
    const countryUUID = topOrgId;

    const processed = [];
    let countRow = 0;

    let totalRows = 0;

    let recordCount = 0;
    let saveBundle = {
      id: uuid4(),
      resourceType: 'Bundle',
      type: 'batch',
      entry: [],
    };

    const fakeOrgId = {
      name: orgname,
      parent: null,
      uuid: topOrgId,
      parentUUID: null,
    };
    let fakeOrgIdAdded = false;
    const invalidIDChars = [/\//g, /\s/g];
    let csvRows = []
    let queries = []
    uploadToSql.buildSQL(JSON.parse(JSON.stringify(fakeOrgId)), queries, database)
    csv
      .fromPath(filePath, {
        headers: true,
      })
      .on('data', async(data) => {
        csvRows.push(data)
      }).on('end', async() => {
        for(let data of csvRows) {
          const jurisdictions = [];
          countRow++;
          if (data[headerMapping.facility] == '') {
            // countRow++;
            const percent = parseFloat((countRow * 100 / csvRows.length).toFixed(1));
            const uploadReqPro = JSON.stringify({
              status: '3/3 Writing Uploaded data into server',
              error: null,
              percent,
            });
            redisClient.set(uploadRequestId, uploadReqPro);
            logger.error(`Skipped ${JSON.stringify(data)}`);
            return;
          }
          for (const invalidChar of invalidIDChars) {
            data[headerMapping.code] = data[headerMapping.code].replace(invalidChar, '-');
          }
          const facilityParent = {};
          for(let level of levels) {
            if (data[headerMapping[level]] != null
              && data[headerMapping[level]] != undefined
              && data[headerMapping[level]] != false
              && data[headerMapping[level]] != ''
            ) {
              let name = data[headerMapping[level]].trim();
              name = mixin.toTitleCaseSpace(name);
              const levelNumber = parseInt(level.replace('level', ''));
              let mergedParents = '';

              // merge parents of this location
              for (let k = levelNumber - 1; k >= 1; k--) {
                let parent = data[headerMapping[`level${k}`]].trim();
                parent = mixin.toTitleCaseSpace(parent);
                // parent = parent.toLowerCase();
                mergedParents += parent;
              }
              if (levelNumber.toString().length < 2) {
                var namespaceMod = `${namespace}00${levelNumber}`;
              } else {
                var namespaceMod = `${namespace}0${levelNumber}`;
              }

              const UUID = uuid5(name + mergedParents + database, namespaceMod);
              const topLevels = [...new Array(levelNumber)].map(Function.call, Number);
              // removing zero as levels starts from 1
              topLevels.splice(0, 1);
              topLevels.reverse();
              let parentFound = false;
              let parentUUID = null;
              let parent = null;
              if (levelNumber == 1) {
                parent = orgname;
                parentUUID = countryUUID;
              }
              for(let topLevel of topLevels) {
                const topLevelName = `level${topLevel}`;
                if (data[headerMapping[topLevelName]] && parentFound === false) {
                  let mergedGrandParents = '';
                  for (let k = topLevel - 1; k >= 1; k--) {
                    let grandParent = data[headerMapping[`level${k}`]].trim();
                    grandParent = mixin.toTitleCaseSpace(grandParent);
                    // grandParent = grandParent.toLowerCase();
                    mergedGrandParents += grandParent;
                  }
                  parent = data[headerMapping[topLevelName]].trim();
                  parent = mixin.toTitleCaseSpace(parent);
                  // parent = parent.toLowerCase();
                  let namespaceMod;
                  if (topLevel.toString().length < 2) {
                    namespaceMod = `${namespace}00${topLevel}`;
                  } else {
                    namespaceMod = `${namespace}0${topLevel}`;
                  }
                  parentUUID = uuid5(parent + mergedGrandParents + database, namespaceMod);
                  parentFound = true;
                }
              }
              facilityParent.name = name;
              facilityParent.uuid = UUID;
              if (!processed.includes(UUID)) {
                jurisdictions.push({
                  name,
                  parent,
                  uuid: UUID,
                  parentUUID,
                });
                processed.push(UUID);
                uploadToSql.buildSQL({
                  name,
                  parent,
                  uuid: UUID,
                  parentUUID,
                }, queries, database)
              }
            }
          }
          recordCount += jurisdictions.length;
          if (!fakeOrgIdAdded) {
            jurisdictions.unshift(fakeOrgId);
            fakeOrgIdAdded = true;
            recordCount++;
          }
          this.buildJurisdiction(jurisdictions, saveBundle);
          const facilityName = data[headerMapping.facility].trim();
          const UUID = uuid5(data[headerMapping.code] + database, `${namespace}100`);
          if (!facilityParent.name || !facilityParent.uuid) {
            facilityParent.name = orgname;
            facilityParent.uuid = countryUUID;
          }
          const building = {
            uuid: UUID,
            code: data[headerMapping.code],
            name: facilityName,
            lat: data[headerMapping.lat],
            long: data[headerMapping.long],
            parent: facilityParent.name,
            parentUUID: facilityParent.uuid,
          };
          recordCount++;
          this.buildBuilding(building, saveBundle);
          uploadToSql.buildSQL(JSON.parse(JSON.stringify(building)), queries, database)
          if (recordCount >= 250) {
            const tmpBundle = {
              ...saveBundle,
            };
            saveBundle = {
              id: uuid4(),
              resourceType: 'Bundle',
              type: 'batch',
              entry: [],
            };
            recordCount = 0;
            totalRows += tmpBundle.entry.length;
            await fhirAxios.create(tmpBundle, database).then(() => {
              const percent = parseFloat((countRow * 100 / csvRows.length).toFixed(1));
              const uploadReqPro = JSON.stringify({
                status: '3/3 Writing Uploaded data into server',
                error: null,
                percent,
              });
              let uploadRequestId = `uploadProgress${clientId}`;
              redisClient.set(uploadRequestId, uploadReqPro, 'EX', 1200);
            })
            await uploadToSql.saveSQL(queries)
            queries = []
          }
        }
        if(queries.length > 0) {
          uploadToSql.saveSQL(queries)
        }
        if(saveBundle.entry.length > 0) {
          totalRows += saveBundle.entry.length;
          await fhirAxios.create(saveBundle, database)
        }
        const uploadRequestId = `uploadProgress${clientId}`;
        const uploadReqPro = JSON.stringify({
          status: 'Done',
          error: null,
          percent: 100,
        });
        redisClient.set(uploadRequestId, uploadReqPro, 'EX', 1200);
        callback();
      });
  },

  buildJurisdiction(jurisdictions, bundle) {
    jurisdictions.forEach((jurisdiction) => {
      const resource = {
        meta: {
          profile: config.get('profiles:jurisdiction'),
        },
        resourceType: 'Location',
        type: [{
          coding: [{
            system: 'urn:ietf:rfc:3986',
            code: 'urn:ihe:iti:mcsd:2019:jurisdiction',
            display: 'Jurisdiction',
          }]
        }]
      };
      resource.name = jurisdiction.name;
      resource.status = 'active';
      resource.mode = 'instance';
      resource.id = jurisdiction.uuid;
      resource.identifier = [];
      resource.identifier.push({
        system: 'https://digitalhealth.intrahealth.org/source1',
        value: jurisdiction.uuid,
      });
      if (jurisdiction.parentUUID) {
        resource.partOf = {
          display: jurisdiction.parent,
          reference: `Location/${jurisdiction.parentUUID}`,
        };
      }
      resource.physicalType = {
        coding: [{
          code: 'jdn',
          display: 'Jurisdiction',
          system: 'http://hl7.org/fhir/location-physical-type',
        }],
      };
      bundle.entry.push({
        resource,
        request: {
          method: 'PUT',
          url: `Location/${resource.id}`,
        },
      });
    });
  },

  buildBuilding(building, bundle) {
    const resource = {
      meta: {
        profile: config.get('profiles:facility'),
      },
      resourceType: 'Location',
      type: [{
        coding: [{
          system: 'urn:ietf:rfc:3986',
          code: 'urn:ihe:iti:mcsd:2019:facility',
          display: 'Facility',
        }],
      }],
    };
    resource.status = 'active';
    resource.mode = 'instance';
    resource.name = building.name;
    resource.id = building.uuid;
    resource.identifier = [];
    resource.identifier.push({
      system: 'https://digitalhealth.intrahealth.org/source1',
      value: building.code,
    });
    resource.partOf = {
      display: building.parent,
      reference: `Location/${building.parentUUID}`,
    };
    resource.physicalType = {
      coding: [{
        code: 'bu',
        display: 'Building',
        system: 'http://hl7.org/fhir/location-physical-type',
      }],
    };
    resource.position = {
      longitude: building.long,
      latitude: building.lat,
    };
    bundle.entry.push({
      resource,
      request: {
        method: 'PUT',
        url: `Location/${resource.id}`,
      },
    });
  },

  createGrid(id, topOrgId, buildings, mcsdAll, start, count, callback) {
    const grid = [];
    let allCounter = 1;
    let totalBuildings = 0;
    async.each(buildings, (building, callback) => {
      let lat = null;
      let long = null;
      if (building.resource.hasOwnProperty('position')) {
        lat = building.resource.position.latitude;
        long = building.resource.position.longitude;
      }
      const row = {};
      // if no parent filter is applied then stop in here of all the conditions are satisfied
      if (id === topOrgId) {
        if (allCounter < start) {
          totalBuildings++;
          allCounter++;
          return callback();
        }
        // if no filter is applied then return in here if the grid length is satisfied
        if (grid.length >= count) {
          totalBuildings++;
          return callback();
        }
      }
      if (building.resource.hasOwnProperty('partOf')) {
        this.getLocationParentsFromData(building.resource.partOf.reference, mcsdAll, 'all', (parents) => {
          if (id !== topOrgId) {
            const parentFound = parents.find(parent => parent.id === id);
            if (!parentFound) {
              return callback();
            }
          }
          parents.reverse();
          row.facility = building.resource.name;
          row.id = building.resource.id;
          row.latitude = lat;
          row.longitude = long;
          let level = 1;
          async.eachSeries(parents, (parent, nxtParent) => {
            row[`level${level}`] = parent.text;
            row[`level${level}id`] = parent.id;
            level++;
            return nxtParent();
          }, () => {
            totalBuildings++;
            if (allCounter < start) {
              allCounter++;
              return callback();
            }
            if (grid.length < count) {
              grid.push(row);
            }
            return callback();
          });
        });
      } else if (id !== topOrgId) { // if the filter by parent is applied then dont return buildings that has no parents
        totalBuildings++;
        return callback();
      } else {
        row.facility = building.resource.name;
        row.id = building.resource.id;
        row.latitude = lat;
        row.longitude = long;
        totalBuildings++;
        if (grid.length < count) {
          grid.push(row);
        }
      }
    }, () => callback(grid, totalBuildings));
  },

  createTree(mcsd, topOrg, includeBuilding, callback) {
    const tree = [];
    const lookup = [];
    const addLater = {};
    async.each(mcsd.entry, (entry, callback1) => {
      const found = entry.resource.physicalType && entry.resource.physicalType.coding.find(coding => coding.code === 'bu');
      if (found && !includeBuilding) {
        return callback1();
      }
      let locType;
      if (found) {
        locType = 'bu';
      } else {
        locType = 'ju';
      }
      const {
        id,
      } = entry.resource;
      const item = {
        text: entry.resource.name,
        id,
        data: {
          locType,
        },
        children: [],
      };
      lookup[id] = item;
      if (id === topOrg || !entry.resource.hasOwnProperty('partOf')) {
        tree.push(item);
      } else {
        const parent = entry.resource.partOf.reference.substring(9);
        if (lookup[parent]) {
          lookup[parent].children.push(item);
        } else if (addLater[parent]) {
          addLater[parent].push(item);
        } else {
          addLater[parent] = [item];
        }
      }
      callback1();
    }, () => {
      if (Object.keys(addLater).length > 0) {
        for (id in addLater) {
          if (lookup[id]) {
            lookup[id].children.push(...addLater[id]);
          } else {
            logger.error(`Couldn't find ${id} in tree.`);
          }
        }
      }
      const sortKids = (a, b) => a.text.localeCompare(b.text);
      const runSort = (arr) => {
        arr.sort(sortKids);
        for (item of arr) {
          if (item.children.length > 0) {
            runSort(item.children);
          }
        }
      };
      runSort(tree);
      if (tree.hasOwnProperty(0)) {
        return callback(tree[0].children);
      }
      return callback(tree);
    });
  },
});
