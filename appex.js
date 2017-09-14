/*
  Establish AutoSSH sessions with Local Port forwards on Jmp
*/
const os = require('os');
path = require('path')
var util = require('util');

const transporter = require('./transporter');

/********** CONFIG *************/
const jmpConnection = {
  host: '10.15.48.55',
  username: 'avramach',
  privateKey: path.join(os.homedir(), '.ssh', 'jmp.pem'),
  downloadDir: path.join('/home/avramach', 'che_owl')
};
const dmpConnection = {
  serviceName: 'dmp',
  localPort: 11080,
  remotePort: 8097,
  ipList: []
};
const phConnection = {
  serviceName: 'ph',
  localPort: 11090,
  remotePort: 80,
  ipList: []
};

const transportConfig = {
  transit: jmpConnection,
  destinations: [dmpConnection, phConnection],
  localDir: path.join(os.homedir(), 'che_owl', 'pulledFiles'),
  updateCronString: '* 1 * * *'
};
/********** CONNECTION **********/
transport = transporter(transportConfig);

transport.on('fsReady', function(connInfo) {
  console.log('fsREady ready Recieved ');
  transport.downloadFile('204936019', 'log', '/opt/cisco/heka/logfiles', function(numFile, files) {
    console.error(numFile + ' Files Download Complete: @ ');;
    if (util.isArray(files)) {
      files.forEach(function(file) {
        console.log('Filename : ' + file);
      })
    } else if (util.isString(files)) {
      console.log('Filename : ' + files);
    }
  });
});

transport.on('error', transportErr => {
  console.error('Transport Error: ', transportErr);
});

transport.on('tunnelsReady', function(connInfo) {
  console.log('transport ready');
  transport.start();
  //transport.startWebServer('python -m SimpleHTTPServer 8280 &','/home/avramach/che_owl');
});

transport.on('webServerReady', function(connInfo) {
  console.log('webServerReady Now Pulling File');
  transport.downloadFile('*id-204936019*');
});

transport.on('updateComplete', function(connInfo) {
  console.log('transport updated');
});

setTimeout(function() {
  console.log('60 seconds have passed')
  transport.stop();
}, 60000);
