const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const requireFromString = require('require-from-string');
const config = require('../config');

const fhirAxios = require('./fhirAxios')
const logger = require('../winston');

const _workflowModules = {};

const fhirModules = {
  require: mod => new Promise((resolve, reject) => {
    fhirAxios.read('Library', mod, '', 'DEFAULT').then((library) => {
      const sign = library.content[0].data;
      const module64 = Buffer.from(library.content[1].data, 'base64');
      const module = module64.toString('utf8');


      let moduleAccepted = false;
      const skipSecurity = config.getBool('security:disabled');

      if (skipSecurity) {
        logger.warn('SKIPPING SECURITY CHECK ON REMOTE MODULE:', mod, '. This should only be done in development.');
        moduleAccepted = true;
      } else {
        const verifier = crypto.createVerify('sha256');
        verifier.update(module);

        const publicKeys = Object.values(config.get('keys'));
        for (const key of publicKeys) {
          if (verifier.verify(key, sign, 'base64')) {
            moduleAccepted = true;
            break;
          }
        }
      }

      if (moduleAccepted) {
        // Could also pass in the second args as an object like:
        // { filename: library.name, path: __dirname }
        // and not use third arg to allow relative require
        resolve(requireFromString(module, library.name, { prependPaths: __dirname }));
      } else {
        logger.error(`This module was not SIGNED and cannot be loaded: ${  mod}`);
        reject(null);
      }
    }).catch((err) => {
      reject(err);
    });
  }),
  requireWorkflow: (workflow, library, file) => new Promise((resolve, reject) => {
    if (_workflowModules.hasOwnProperty(workflow)) {
      resolve(_workflowModules[workflow]);
    } else if (file) {
      const fullPath = path.join(__dirname, file);
      if (fs.existsSync(fullPath) || fs.existsSync(`${fullPath}.js`)) {
        const module = require(file);
        if (module.hasOwnProperty('process')) {
          _workflowModules[workflow] = module;
          resolve(_workflowModules[workflow]);
        } else {
          reject(new Error('Invalid workflow module.  No process method.', workflow, file));
        }
      } else {
        reject(new Error('File passed to requireWorkflow not found.', file, attempt));
      }
    } else if (library) {
      fhirModules.require(library).then((module) => {
        if (module.hasOwnProperty('process')) {
          _workflowModules[workflow] = module;
          resolve(_workflowModules[workflow]);
        } else {
          reject(new Error('Invalid workflow library module.  No process method.', workflow, library));
        }
      }).catch((err) => {
        reject(err);
      });
    } else {
      reject(new Error('No library or file passed to requireWorkflow.'));
    }
  }),
};

module.exports = fhirModules;
