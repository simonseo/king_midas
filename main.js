'use strict'

var GoogleSpreadsheet = require('google-spreadsheet');
var async = require('async');
var FacebookApi = require('fb-node');
var creds = require('./creds.json');
require('heroku-self-ping')(creds.herokuAppUrl);

/**
  creds for google api must be issued from https://console.developers.google.com/ as a service account
  and the spreadsheet must be shared with email of the service account client
  creds for fb graph api must be issued from https://developers.facebook.com

  OR, if you cannot save the file locally (like on heroku) 
  var creds_json = {
    "client_email" : 'yourserviceaccountemailhere@google.com',
    "private_key" : 'your long private key stuff here',
    "responseId" : 'unique id of spreadsheet used for storing form responses',
    "archiveId" : 'a blank document',
    "pageToken" : 'another long private key stuff'
  }
*/

// Set endpoint and token
FacebookApi.endpoint = 'https://graph.facebook.com';
FacebookApi.token = creds.fbToken;
 
// the IDs are the unique keys that appear in the URL of Google documents
var responseDoc = new GoogleSpreadsheet(creds.responseSheetId),
    archiveDoc = new GoogleSpreadsheet(creds.archiveSheetId);
var responseSheet,
    archiveSheet;



function setup() {
  //runs once
  async.series([
    function setResponseAuth(step) {
      //authenticates service account with given credentials
      responseDoc.useServiceAccountAuth(creds,step);
    },
    function setArchiveAuth(step) {
      //see above
      archiveDoc.useServiceAccountAuth(creds, step);
    },
    function getResponseDoc(step) {
      //gets input spreadsheet created from form
      responseDoc.getInfo(function(err, info) {
        console.log('Loaded responseDoc: '+info.title+' by '+info.author.email);
        responseSheet = info.worksheets[0];
        console.log('responseSheet 1: '+responseSheet.title+' '+responseSheet.rowCount+'x'+responseSheet.colCount);
        step();
      });
    },
    function getArchiveDoc(step) {
      //gets spreadsheet for archiving
      archiveDoc.getInfo(function(err, info) {
        console.log('Loaded archiveDoc: '+info.title+' by '+info.author.email);
        archiveSheet = info.worksheets[0];
        console.log('archiveSheet 1: '+archiveSheet.title+' '+archiveSheet.rowCount+'x'+archiveSheet.colCount);
        step();
      });
    },
    function loopWrapper(step) {
      loop(5*1000);
    }
  ]);
}

function loop(loopPeriod) {
  //runs every <loopPeriod> seconds
  var header = {},
      originalHeader = [];
  var existsUpdate = false;
  var newContent = [];
  async.series([
    function saveHeader(step) { 
      //save normalized header so that it can be used for getting values from each row object
      responseSheet.getCells({
        'min-row' : 1,
        'max-row' : 1,
        'return-empty' : false
      }, function(err, cells) {
        if (err) {
          console.log(err);
        }
        else {
          originalHeader = [cells[0].valueForSave, cells[1].valueForSave];
          header.timestamp = normalize(originalHeader[0]);
          header.content = normalize(originalHeader[1]);          
        }
        step();
      });
    },
    function checkUpdate(step) {
      //check if there are updates in input spreadsheet
      responseSheet.getRows({
        offset: 1,
        orderby: 'col1'
      }, function(err, rows) {
        if (err) {
          console.log(err);
        }
        else {
          existsUpdate = !!rows.length;
          if (existsUpdate) {
            console.log('Read '+rows.length+' rows');
            for (var i = 0; i < rows.length; i++) {
              var row = rows[i];
              var temp = {};
              temp[header.timestamp] = row[header.timestamp];
              temp[header.content] = row[header.content];
              newContent.push(temp);
            }
            step();
          }
          else {
            setTimeout(step, loopPeriod); //if no update, sleep for <loopPeriod> seconds before jumping
          }
        } 
      });
    },
    function setHeader(step) {
      //set header in archive as equivalent to input
      if (existsUpdate) {
        try {
          archiveSheet.setHeaderRow(originalHeader, step);
        }
        catch(err) {
          console.log(err);
        }
      } else {
        step();
      }
    },
    function archiveUpdate(step) {
      //copies data from input to archive
      if (existsUpdate) {
        for (var i = 0; i < newContent.length; i++) {
          archiveDoc.addRow(1, newContent[i], function(err) {
            if(err) {
              console.log(err);
            }
          });
        }
      }
      step();
    },
    function postFacebook(step) {
      if (existsUpdate) {
        for (var i = 0; i < newContent.length; i++) {
          var url = '/' + creds.fbPageId + '/feed';
          var dataOut = {};
          dataOut.message = newContent[i][header.content];
          FacebookApi.post(url, dataOut).then(function (data) {
            console.log(data.json);
          }).catch(function(e){
            console.log(e);
          }).finally(function(){
            console.log('Done with the request');
          });
        }
      }
      step();
    },
    function removeOldData(step) {
      //deletes data from input
      if (existsUpdate) {
        responseSheet.getRows({
          offset: 1
        }, function(err, rows) {
          if (err) {
            console.log(err);
          }
          else {
            try {
              for (var i = rows.length - 1; i >= 0; i--) {
                rows[i].del();
              }
            }
            catch(err){
              console.log(err);
            }
          }
        });
        existsUpdate = false;
      }
      step();
    },
    function loopWrapper(step) {
      loop(loopPeriod);
    }
  ]);
}

function normalize(str) {
  return str.toLowerCase().replace(/\s/g,'');
}

setup();