/* eslint-disable no-restricted-syntax */
/* eslint-disable func-names */
const uuid5 = require('uuid/v5');
const csv = require('fast-csv');
const async = require('async');
const moment = require('moment');
const crypto = require('crypto');
const fs = require('fs');
const config = require('./config');
const logger = require('./winston');
const ihrissmartrequire = require('ihrissmartrequire')

module.exports = {
  getFilesFromDir(searchDir) {
    return new Promise(async (resolve, reject) => {
      const filesPath = [];
      let dirs;
      try {
        dirs = await fs.readdirSync(searchDir);
      } catch (error) {
        return reject(error);
      }
      const dirsPromises = [];
      dirs.forEach(async (dir) => {
        if (!fs.lstatSync(`${searchDir}/${dir}`).isDirectory()) {
          filesPath.push(`${searchDir}/${dir}`);
          return;
        }
        dirsPromises.push(new Promise((dresolve, dreject) => {
          fs.readdir(`${searchDir}/${dir}`, (err, files) => {
            if (err) {
              return dreject();
            }
            files.forEach((file) => {
              filesPath.push(`${searchDir}/${dir}/${file}`);
              return dresolve();
            });
          });
        }));
      });
      Promise.all(dirsPromises).then(() => resolve(filesPath)).catch(() => reject());
    });
  },
  isFloat(val) {
    val = parseFloat(val);
    return +val === val && (!isFinite(val) || !!(val % 1));
  },
  isInt(val) {
    val = Number(val);
    return val === +val && isFinite(val) && !(val % 1);
  },
  getTopOrgId(dbname, resourceType) {
    return uuid5(dbname + resourceType, '16b229bc-eba5-4e99-abec-aaa0d1462583');
  },
  getMappingId(id) {
    return uuid5(id.toString(), '16b229bc-eba5-4e99-abec-aaa0d1462583');
  },
  getLatestFacilityRequest(extensions, type, username) {
    const facilityUpdateRequestURI = this.getCodesysteURI('facilityUpdateRequest');
    const facilityAddRequestURI = this.getCodesysteURI('facilityAddRequest');
    let requestURI;
    if (type === 'add') {
      requestURI = facilityAddRequestURI.uri;
    } else if (type === 'update') {
      requestURI = facilityUpdateRequestURI.uri;
    }
    let latestExt;
    let latestDate;
    for (const extension of extensions) {
      if (extension.url === requestURI) {
        let statusDate = extension.extension.find(ext => ext.url === 'statusDate');
        const userFound = extension.extension.find(ext => ext.url === 'username' && ext.valueString === username);
        if (username && !userFound) {
          statusDate = null;
        }
        if (!latestExt && statusDate) {
          latestExt = extension.extension;
          latestDate = statusDate.valueDate;
        } else if (statusDate) {
          statusDate = moment(statusDate.valueDate).format('Y-M-DTHH:mm:ssZ');
          latestDate = moment(latestDate).format('Y-M-DTHH:mm:ssZ');
          if (statusDate > latestDate) {
            latestExt = extension.extension;
            latestDate = statusDate.valueDate;
          }
        }
      }
    }
    return latestExt;
  },
  createCodeableConcept(codes, system) {
    const codeableConcept = [];
    codes.forEach((code) => {
      let codeSystem = system;
      if (code.system) {
        codeSystem = code.system;
      }
      const coding = [{
        system: codeSystem,
        code: code.code,
        display: code.display,
      }];
      codeableConcept.push({
        coding,
        text: code.display,
      });
    });
    return codeableConcept;
  },
  getCodesysteURI(codeSystemType) {
    const codeSystems = config.get('codeSystems');
    const codeSyst = codeSystems.find(code => code.name === codeSystemType);
    return codeSyst;
  },
  toTitleCase(str) {
    if (!str) {
      return str;
    }
    str = str.toLowerCase().split(' ').map(word => word.replace(word[0], word[0].toUpperCase())).join('');
    return str;
  },
  toTitleCaseSpace(str) {
    if (!str) {
      return str;
    }
    str = str.toLowerCase();
    return str.replace(/[^\s]+/g, word => word.replace(/^./, first => first.toUpperCase()));
  },
  getIdFromIdentifiers(identifier, system) {
    if (!Array.isArray(identifier)) {
      logger.error('Identifier submitted is not an array');
      return false;
    }
    const matchedIdentifier = identifier.find(identifier => identifier.system === system);
    let matchedId;
    if (matchedIdentifier) {
      matchedId = matchedIdentifier.value.split('/').pop();
    }
    return matchedId;
  },
  createIdHierarchy(mcsdSource, parentId) {
    const sourceEntry = mcsdSource.find(entry => entry.id === parentId);
    const idHierarchy = {
      id: parentId,
      name: parentId,
      children: [],
    };
    if(typeof sourceEntry.code === 'string') {
      sourceEntry.code = JSON.parse(sourceEntry.code)
    }
    if(typeof sourceEntry.otherid === 'string') {
      sourceEntry.otherid = JSON.parse(sourceEntry.otherid)
    }
    if (sourceEntry && (sourceEntry.code.length > 0 || sourceEntry.otherid.length > 0)) {
      let ids = sourceEntry.code
      ids = ids.concat(sourceEntry.otherid)
      for (const identifier of ids) {
        if (identifier === parentId) {
          continue;
        }
        idHierarchy.children.push({
          id: identifier,
          name: identifier,
        });
      }
    }
    return [idHierarchy];
  },
  haveIdInCommon(identifiers1, identifiers2) {
    if (!Array.isArray(identifiers1) || !Array.isArray(identifiers2)) {
      return false;
    }
    const commonID = identifiers1.find(identifier1 => identifiers2.find(identifier2 => identifier2.value === identifier1.value));
    if (commonID) {
      return true;
    }
    return false;
  },

  validateCSV(filePath, headerMapping, callback) {
    const invalid = [];
    const ids = [];
    const levels = config.get('levels');
    levels.sort();
    levels.reverse();
    csv
      .fromPath(filePath, {
        headers: true,
      })
      .on('data', (data) => {
        let rowMarkedInvalid = false;
        let index = 0;
        async.eachSeries(levels, (level, nxtLevel) => {
          if (headerMapping[level] === null
            || headerMapping[level] === 'null'
            || headerMapping[level] === undefined
            || !headerMapping[level]) {
            return nxtLevel();
          }
          if (data[headerMapping.code] == '') {
            populateData(headerMapping, data, 'Missing Facility ID', invalid);
            rowMarkedInvalid = true;
          }
          if (data[headerMapping.lat] && !this.isFloat(data[headerMapping.lat]) && !this.isInt(data[headerMapping.lat])) {
            populateData(headerMapping, data, 'Invalid Characters In latitude', invalid);
            rowMarkedInvalid = true;
          }
          if (data[headerMapping.long] && !this.isFloat(data[headerMapping.long]) && !this.isInt(data[headerMapping.long])) {
            populateData(headerMapping, data, 'Invalid Characters In longitude', invalid);
            rowMarkedInvalid = true;
          }
          if (index === 0) {
            index += 1;
            if (ids.length == 0) {
              ids.push(data[headerMapping.code]);
            } else {
              const idExist = ids.find(id => id === data[headerMapping.code]);
              if (idExist) {
                rowMarkedInvalid = true;
                const reason = 'Duplicate ID';
                populateData(headerMapping, data, reason, invalid);
              } else {
                ids.push(data[headerMapping.code]);
              }
            }
          }
          if (!rowMarkedInvalid) {
            if (data[headerMapping[level]] === null
              || data[headerMapping[level]] === undefined
              || data[headerMapping[level]] === false
              || !data[headerMapping[level]]
              || data[headerMapping[level]] === ''
              || !isNaN(headerMapping[level])
              || data[headerMapping[level]] == 0) {
              const reason = `${headerMapping[level]} is blank`;
              populateData(headerMapping, data, reason, invalid);
            } else {
              return nxtLevel();
            }
          }
        }, () => {
          if (data[headerMapping.facility] === null
            || data[headerMapping.facility] === undefined
            || data[headerMapping.facility] === false
            || data[headerMapping.facility] === ''
            || data[headerMapping.facility] == 0) {
            const reason = `${headerMapping.facility} is blank`;
            populateData(headerMapping, data, reason, invalid);
          }
        });
      })
      .on('end', () => callback(true, invalid));

    function populateData(headerMapping, data, reason, invalid) {
      const row = {};
      for (const header in headerMapping) {
        if (header == 'null') {
          return nxtHeader();
        }
        if (!data.hasOwnProperty(header)) {
          continue;
        }
        row[header] = data[header];
      }
      invalid.push({
        data: row,
        reason,
      });
    }
  },
  setNestedKey(obj, path, value) {
    if (path.length === 1) {
      obj[path] = value;
      return;
    }
    this.setNestedKey(obj[path[0]], path.slice(1), value);
  },
  updateConfigFile(path, newValue, callback) {
    const pathString = path.join(':');
    config.set(pathString, newValue);
    logger.info('Updating config file');
    const configFile = ihrissmartrequire.path("config/default.json");
    const configData = require(configFile);
    this.setNestedKey(configData, path, newValue);
    setTimeout(() => {
      fs.writeFile(configFile, JSON.stringify(configData, 0, 2), (err) => {
        if (err) {
          throw err;
        }
        logger.info('Done updating config file');
        return callback();
      });
    }, 100);
  },
  encrypt(text) {
    const algorithm = config.get('encryption:algorithm');
    const secret = config.get('encryption:secret');
    const cipher = crypto.createCipher(algorithm, secret);
    let crypted = cipher.update(text, 'utf8', 'hex');
    crypted += cipher.final('hex');
    return crypted;
  },
  decrypt(text) {
    const algorithm = config.get('encryption:algorithm');
    const secret = config.get('encryption:secret');
    const decipher = crypto.createDecipher(algorithm, secret);
    let dec = decipher.update(text, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  },
  flattenExtension(extension) {
    const results = {};
    for (const ext of extension) {
      let value = '';
      for (const key of Object.keys(ext)) {
        if (key !== 'url') {
          value = ext[key];
        }
      }
      if (results[ext.url]) {
        if (Array.isArray(results[ext.url])) {
          results[ext.url].push(value);
        } else {
          results[ext.url] = [results[ext.url], value];
        }
      } else if (Array.isArray(value)) {
        results[ext.url] = [value];
      } else {
        results[ext.url] = value;
      }
    }
    return results;
  },
  createLevelMapping(levelData) {
    const levels = Object.keys(levelData);
    const levelMapping = {};
    for (const level of levels) {
      if (level.startsWith('level') && levelData[level]) {
        levelMapping[level] = levelData[level];
      }
    }
    levelMapping.code = levelData.code;
    levelMapping.facility = levelData.facility;
    return levelData;
  },
};
