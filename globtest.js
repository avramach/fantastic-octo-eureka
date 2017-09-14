var glob = require('glob-fs')({
  gitignore: true
});
var fs = require('fs-extra');
const async = require("async");


var deviceId = 204936019;
var downloadedDir = '/home/avra/che_owl/pulledFiles/mountDir';
var globPattern = '*' + deviceId + '*';
//var globPattern =  '*.js';
console.log('Pattern ' + globPattern)


glob.readdir(globPattern, {
  cwd: downloadedDir
}, function(err, files) {
  if (err) {
    console.error('shipping From Download to Local Failed ' + err);
    return;
  }
  console.log('Num of Files Matching Pattern files ' + files.length);

  function moveFile(file, callback) {
    var destName = '/home/avra/che_owl/pulledFiles/logs/204936019/log.uts-1500649308058.id-204936019.dt-STB.gz'
    var srcName ='/home/avra/che_owl/pulledFiles/mountDir/log.uts-1500649308058.id-204936019.dt-STB.gz'
      console.error('Moving it');
    fs.move(srcName, destName, {
      overwrite: true
    }, err => {
      if (err) {
      console.error('We errored out');
        return console.error(err)
      }
      console.error('Calling the callback');
      callback(null,destName);
    })
  }
  async.map(files, moveFile, function(err, results) {
    if (err) {
      console.error('async Error');
      return console.error(err)
    }
    console.error("finished Moving " + results.length + ' files');
  })

});
