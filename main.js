var GoogleSpreadsheet = require('google-spreadsheet');
var async = require('async');
 
var spreadsheetId = require('./spreadsheetId')
var responseDoc = new GoogleSpreadsheet(spreadsheetId.response),
    archiveDoc = new GoogleSpreadsheet(spreadsheetId.archive);
var responseSheet,
    archiveSheet;
var creds = require('./google-drive-creds.json');

// OR, if you cannot save the file locally (like on heroku) 
// var creds_json = {
//   client_email: 'yourserviceaccountemailhere@google.com',
//   private_key: 'your long private key stuff here'
// }

var header = {},
    originalHeader = [];
var existsUpdate = false;
var newContent = [];

async.series([
  function setResponseAuth(step) {
    responseDoc.useServiceAccountAuth(creds,step);
  },
  function setArchiveAuth(step) {
    archiveDoc.useServiceAccountAuth(creds, step);
  },
  function getResponseDoc(step) {
    responseDoc.getInfo(function(err, info) {
      console.log('Loaded responseDoc: '+info.title+' by '+info.author.email);
      responseSheet = info.worksheets[0];
      console.log('responseSheet 1: '+responseSheet.title+' '+responseSheet.rowCount+'x'+responseSheet.colCount);
      step();
    });
  },
  function getArchiveDoc(step) {
    archiveDoc.getInfo(function(err, info) {
      console.log('Loaded archiveDoc: '+info.title+' by '+info.author.email);
      archiveSheet = info.worksheets[0];
      console.log('archiveSheet 1: '+archiveSheet.title+' '+archiveSheet.rowCount+'x'+archiveSheet.colCount);
      step();
    });
  },
  function saveHeader(step) { //save normalized header so that it can be used for getting values from each row object
    responseSheet.getCells({
      'min-row' : 1,
      'max-row' : 1,
      'return-empty' : false
    }, function(err, cells) {
      console.log("cells", cells);
      originalHeader = [cells[0].valueForSave, cells[1].valueForSave];
      header.timestamp = normalize(originalHeader[0]);
      header.content = normalize(originalHeader[1]);
      console.log("header", header);
      step();
    });
  },
  function checkUpdate(step) {
    responseSheet.getRows({
      offset: 1,
      orderby: 'col1'
    }, function(err, rows) {
      console.log('Read '+rows.length+' rows');
      existsUpdate = !!rows.length;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var temp = {};
        temp[header.timestamp] = row[header.timestamp];
        temp[header.content] = row[header.content];
        console.log(temp);
        newContent.push(temp);
      }
      console.log("=== newContent arrived ===\n", newContent);
      step();
    });
  },
  function setHeader(step) {
    if (existsUpdate) {
      archiveSheet.setHeaderRow(originalHeader, step);
    }
  },
  function archiveUpdate(step) {
    if (existsUpdate) {
      for (var i = 0; i < newContent.length; i++) {
        archiveDoc.addRow(1, newContent[i], function(err) {
          if(err) { console.log(err); }
        });
      }
    }
    step();
  },
  function removeOldData(step) {
    if (existsUpdate) {
      responseSheet.getRows({
        offset: 1
      }, function(err, rows) {
        for (var i = rows.length - 1; i >= 0; i--) {
          rows[i].del();
        }
      });
    }
    step();
  }
]);

function normalize(str) {
  return str.toLowerCase().replace(/\s/g,'');
}