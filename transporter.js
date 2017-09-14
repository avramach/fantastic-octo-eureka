require('coffee-script/register');
node_ssh = require('node-ssh')
var events = require('events');
var stringSearcher = require('string-search');
var ssh = new node_ssh()
const autossh = require('autossh');
const os = require('os');
var stringTokenizer = require("string-tokenizer")
var sshfsNode = require("sshfs-node")
var fs = require('fs-extra');
var glob = require('glob-fs')({
  gitignore: true
});
const async = require("async");
var ps = require('ps-node');

class Transporter extends events.EventEmitter {
  /*/
   */
  constructor(conf = {}) {
    super();

    this.configure(conf);

    setImmediate(() => {
      this.start();
    });

    process.on('exit', () => {
      console.log('TearDown');
      this.teardown();
    });
  }

  configure(conf) {
    this.destinations = [];
    this.transit = conf.transit;
    this.destinations = conf.destinations;
    this.updateCronString = conf.updateCronString;
    this.localDir = conf.localDir;
  }

  killSSHTunnels() {
    ps.lookup({
      command: 'ssh',
      arguments: '-NL',
    }, function(err, resultList) {
      if (err) {
        throw new Error(err);
      }
      resultList.forEach(function(process) {
        if (process) {
          console.log('PID: %s, COMMAND: %s, ARGUMENTS: %s', process.pid, process.command, process.arguments);
          ps.kill(process.pid, function(err) {
            if (err) {
              throw new Error(err);
            } else {
              console.log('Process %s has been killed!', process.pid);
            }
          });
        }
      });
    });
  }


  teardown() {
    this.destinations.forEach(function(destination) {
      if (destination.tunnel != undefined && destination.tunnel.status === 'ready') {
        destination.tunnel.client.kill();
        console.error('Tunnel Removed Pid ' + destination.tunnel.connInfo.pid);
      }
    });
    this.killSSHTunnels();
    sshfsNode.umount(this.mountPath, true, function() {
      console.error('Umount Processed');
    })

  }

  CheckInstanceIp(novalist, destination) {
    return new Promise(function(resolve, reject) {
      stringSearcher.find(novalist, destination.serviceName)
        .then(function(resultArr) {
          resultArr.forEach(function(result) {
            var re1 = '.*?';
            var re2 = '((?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))(?![\\d])';
            var ipAddr = stringTokenizer().input(result.text).token('ip', re1 + re2).resolve();
            destination.ipList.push(ipAddr.ip);
            resolve(ipAddr.ip);
          });
        })
    })
  }

  setupPortForwards(novalist) {
    var self = this;
    self.pollStarted = false;
    this.destinations.forEach(function(destination) {
      var promise = self.CheckInstanceIp(novalist, destination);
      promise.then(function(data) {
        console.log(destination.serviceName + '  Instance Returning IP     ' + destination.ipList[0]);
        destination.tunnel = self.setAutoSSH(destination);
        if (self.pollStarted === false) {
          console.log('Setting PollFunction');
          self.pollStarted = setInterval(function() {
            self.pollTunnelStatus(self);
          }, 2000);
          console.log('SetPollFunction');
        }
      });
    });
  }

  pollTunnelStatus(self) {
    console.log('PollFunctionEntry');
    self.tunnelReadyCount = 0;
    self.pollInterval++;
    if (self.pollInterval > 30) {
      self.emit('error');
      clearInterval(self.pollStarted);
    }

    self.destinations.forEach(function(destination) {
      if (typeof(destination.tunnel) != "undefined") {
        if (destination.tunnel.status === 'ready') {
          self.tunnelReadyCount++;
        }
      }
    });
    if (self.tunnelReadyCount == self.destinations.length) {
      clearInterval(self.pollStarted);
      console.log('Cleared PollFunction');
      self.emit('tunnelsReady');
    }
  }

  updateTunnelStatus(state, connInfo) {
    this.destinations.forEach(function(destination) {
      if (state === 'ready') {
        if (destination.localPort == connInfo.localPort) {
          destination.tunnel.connInfo = connInfo;
          destination.tunnel.status = state;
          console.log(state + ' update status for ' + connInfo.localPort);
        }
      } else if (state === 'error') {
        this.emit('tunnelerror');
      }
    });
  }

  sshCon() {
    return ssh.connect({
      host: '10.15.48.55',
      username: 'avramach',
      privateKey: path.join(os.homedir(), '.ssh', 'jmp.pem')
    });
  }

  start() {
    var self = this;
    var promise = this.sshCon();
    var promise2 = promise.then(function() {
      console.log('Start Novalist');
      return ssh.execCommand('cat /opt/ssh_monkey/nova_server_config_green.cfg');
    });
    promise2.then(function(result) {
      ssh.dispose();
      console.log('Start setupPortForwards');
      self.setupPortForwards(result.stdout);
    });
  }

  setAutoSSH(destination) {
    var self = this;
    var autosshClient = autossh({
      host: this.transit.host,
      username: this.transit.username,
      privateKey: this.transit.privateKey,
      localPort: destination.localPort,
      remotePort: destination.remotePort,
      localHost: destination.ipList[0],
      maxPollCount: 50,
      pollTimeout: 1000
    });

    autosshClient.on('error', err => {
      console.error('ERROR: ', err);
      self.updateTunnelStatus('error', null);
    });

    autosshClient.on('timeout', connection => {
      console.warn('Connection to ' + connection.host + ' timed out.');
      self.updateTunnelStatus('timeout', connection);
    });

    autosshClient.on('connect', connection => {
      console.log('Tunnel established on port ' + connection.localPort);
      console.log('pid: ' + connection.pid);
      console.log('string: ' + connection.execString);
      self.updateTunnelStatus('ready', connection);
    });

    return {
      connInfo: null,
      status: 'init',
      serviceName: destination.serviceName,
      client: autosshClient
    };
  }


  getFile(localPath, remotePath) {
    var promise = this.sshCon();
    var promise2 = promise.then(function() {
      return ssh.getFile(localPath, remotePath);
    });
    promise2.then(function(Contents) {
      console.log("The File's contents were successfully downloaded")
      ssh.dispose();
    }, function(error) {
      console.log("Something's wrong")
      console.log(error)
    })
  }


  execCommand(cmd, wd) {
    var self = this;
    return new Promise(function(resolve, reject) {
      console.error('SSH CON');
      var promise = self.sshCon();
      var promise2 = promise.then(function() {
        console.error('SSH EXEC ' + cmd);
        return ssh.execCommand(cmd, {
          cwd: wd
        });
      });
      promise2.then(function(result) {
        console.error('SSH DISP');
        ssh.dispose();
        console.log('COMMAND EXEC SUCCESS ' + result.stdout);
        resolve('success');
      }, function(err) {
        console.error(cmd+' COMMAND EXEC FAILED '+err);
        reject(err);
      });
    });
  }
  execProcess(cmd, parameters, wd, pty) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var promise = self.sshCon();
      var promise2 = promise.then(function() {
        console.error('SSH EXEC');
        //exec(command: string, parameters: Array<string>, options: { cwd?: string, options?: Object, stdin?: string, stream?: 'stdout' | 'stderr', 'both' } = {}): Promise<Object | string>
        //return ssh.exec(cmd,parameters,{cwd:wd,stream:'stderr'});
        return ssh.execCommand('date');
      });
      promise2.then(function(result) {
        console.error('SSH DISP');
        ssh.dispose();
        console.log('COMMAND EXEC SUCCESS ' + result.stdout);
        resolve('success');
      }, function(err) {
        console.error('COMMAND EXEC FAILED');
        reject(err);
      });
    });
  }

  startWebServer(cmd, wd) {
    //console.log(cmd+ 'TunnelsReady ,starting Web Server '+wd);
    //var promise = this.execCommand(cmd,wd);
    var promise = this.execProcess('python', ['-v', '-m', 'SimpleHTTPServer', '8280'], wd, false);
    promise.then(function(result) {
      console.error('Finished Starting webServerReady');
      self.emit('webServerReady');
      console.error('Pushed');
    }, function(err) {
      console.error('Starting Webserver Failed ' + err)
    });
  };

  startSSHFs() {
    var self = this;
    var baseDir = this.localDir;
    console.log('starting SSHFs');
    console.log('Base Download Dir ' + baseDir);

    if (!fs.existsSync(baseDir)) {
      console.log('Creating Download Dir ' + baseDir);
      fs.mkdirSync(this.localDir);
    }
    self.logsDir = path.join(baseDir, 'logs');
    console.log('Log Dir ' + self.logsDir);
    if (!fs.existsSync(self.logsDir)) {
      console.log('Log Dir Created ' + self.logsDir);
      fs.mkdirSync(self.logsDir);
    }
    self.coreDir = path.join(baseDir, 'cores');
    console.log('Core Dir ' + self.coreDir);
    if (!fs.existsSync(self.coreDir)) {
      console.log('Core Dir Created ' + self.coreDir);
      fs.mkdirSync(self.coreDir);
    }
    self.mountPath = path.join(baseDir, 'mountDir');
    console.log('Mount Path ' + self.mountPath);

    if (!fs.existsSync(self.mountPath)) {
      console.log('mount Dir Created ' + self.mountPath);
      fs.mkdirSync(self.mountPath);
    }
    fs.emptyDirSync(self.mountPath);

    sshfsNode.mount(this.transit.host, self.mountPath, {
      identityFile: path.join(os.homedir(), '.ssh', 'jmp.pem'),
      user: this.transit.username,
      path: this.transit.downloadDir
    }, function(err) {
      if (err) {
        console.error('Starting SSHFS mount Failed ' + err);
        return
      }
      self.emit('fsReady');
    });
  }

  pullFiletoJmp(fileNamePattern) {
    var self = this;
    return new Promise(function(resolve, reject) {
      self.destinations.forEach(function(destination) {
        if (destination.serviceName.includes('dmp')) {

          var dmp = destination;

          function PullDMP(dmpIp, callBack) {
            console.error(dmpIp + ' Trying Destination To Pull From ' + dmp.serviceName);
            var promise = self.execCommand('scp -i  ~/pems/ih-keypair_f-brei-live2.pem root@' + dmpIp + ':' + fileNamePattern + ' .', self.transit.downloadDir);
            promise.then(function(result) {
              callBack(null, result);
            }, function(err) {
               console.error('SSH EXEC promise Failed '+err);
              return err;
            })
          }
          async.map(destination.ipList, PullDMP, function(err, results) {
            if (err) {
              console.error('async pullDMP Error');
              console.error(err)
              return reject(err);
            }
            console.error('Finished DMP Scp commands ');
            resolve(results);
          });
        } else {
          console.error(destination.serviceName + ' Destination did not Match DMP');
        }
      })
    });
  }

  downloadFile(deviceId, filetype, remoteDir, cb) {
    console.log("Donwlaod File from DMP to Jmp");
    var self = this;
    var deviceDir = 0;
    var namePattern = remoteDir + '/*' + deviceId + '*';
    console.log('NamePattern ' + namePattern);
    var promise = this.pullFiletoJmp(namePattern);
    promise.then(function() {
        console.log("Donwlaoded");
        if (filetype === 'core') {
          deviceDir = path.join(self.coreDir, deviceId);
          console.log('File type is C ' + filetype);
        } else {
          deviceDir = path.join(self.logsDir, deviceId);
          console.log('File type is L ' + filetype);
        }
        console.log('Device Dir is  ' + deviceDir);
        if (!fs.existsSync(deviceDir)) {
          console.log('Creating Device Dir is  ' + deviceDir);
          fs.mkdirSync(deviceDir);
        }
        var globPattern = '*' + deviceId + '*';
        console.log('Glob Pattern ' + globPattern);
        console.log('Mount path ' + self.mountPath);
        glob.readdir(globPattern, {
          cwd: self.mountPath
        }, function(err, files) {
          if (err) {
            console.error('shipping From Download to Local Failed ' + err);
            return;
          }

          console.log('Num of Files Matching Pattern files ' + files.length);
          ///This is an sftp Action ,be patient
          function moveFile(file, callback) {
            var destName = path.join(deviceDir, file);
            var srcName = path.join(self.mountPath, file);
            console.log(srcName + ' Moved to destName ' + destName);
            console.error('Moving it');
            fs.move(srcName, destName, {
              overwrite: true
            }, err => {
              if (err) {
                console.error('We errored out in Moving File');
                return console.error(err)
              }
              console.error('Calling the callback');
              callback(null, destName);
            })
          }
          async.map(files, moveFile, function(err, results) {
            if (err) {
              console.error('async Error');
              return console.error(err)
            }
            console.error("finished Moving " + results.length + ' files');
            cb(results.length, results);
          })

        });
      },
      function(err) {
        console.log("Pull From DMP to Jmp Failed " + err);
      });

  }
}


module.exports = function(conf) {
  const transporter = new Transporter(conf);

  const transporterInterface = {
    on(evt, ...args) {
      transporter.on(evt, ...args);
      return this;
    },
    //Port In Use,VPN disconnect , RemotePort Already Binded,Jmp Issues
    start() {
      transporter.startSSHFs();
    },

    //Lot of Cleanup SSHFS,Tunnels,Files
    stop() {
      transporter.teardown();
    },

    startWebServer(cmd, wd) {
      console.log('starting Web Server');
      transporter.startWebServer(cmd, wd);
    },

    downloadFile(deviceId, filetype, remoteDir, cb) {
      transporter.downloadFile(deviceId, filetype, remoteDir, cb);
    }
  };

  return transporterInterface;
};
