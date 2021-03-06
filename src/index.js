// Required modules
import Client from "ssh2-sftp-client"
import csv from "csvtojson"
import fs from 'fs'
import dotenv from 'dotenv'
import DB from './db.js'
import Notif from './notification.js'
import Progress from './Progress.js'
import { Parser } from "json2csv"
dotenv.config();

function timeConverter(UNIX_timestamp) {
    const a = new Date(UNIX_timestamp);
    return a.getDate() + '/' + (a.getMonth() + 1) + '/' + a.getFullYear();
}

function compDate(d1, d2) {
    d1 = d1.split('/').map(l => parseInt(l))
    d2 = d2.split('/').map(l => parseInt(l))
    if (d1 === d2)
        return 0
    else {
        if (d1[2] === d2[2]) {
            if (d1[1] === d2[1]) {
                if (d1[0] === d2[0]) {
                    return 0
                } else return d1[0] - d2[0]
            } else return d1[1] - d2[1]
        } else return d1[2] - d2[2]
    }
}
function blok(s) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve()
        }, s * 1000)
    })
}
class CRAWLO_FTP_MONITOR {
    constructor() {
        this.sftp = new Client();
        this.db = new DB()

        this.notif = new Notif({
            GMAIL: process.env.CFM_GMAIL,
            PASS: process.env.CFM_GMAIL_PASS,
            Receiver_users: process.env.CFM_RECEIVER_USERS.split(' ')
        })
        this.type = ''; // ['first' || 'second' || '']   '' <= for both
        this.data = []
        this.list = []
        this.currentFile = {
            path: '', size: 0, rows: 0, date: 0, data: []
        }
        this.rapport = {}
        this.timer = []
        this.fields = ['date', 'size', 'rows']
        this.onProgress = false
    }

    async init() {
        try {
            await this.connect()
            await this.fetchAllFiles();
            this.type = 'first'
            await this.daily()
            // this.type = 'second'
            // await this.daily()
            console.log(process.env.CFM_RECEIVER_USERS.split(' ').map(l => '[ ' + l.replace(/@crawlo\.com/, '') + ' ]').sort())
            this.dailyTimer('first', 8, 7, 0, 1)
            this.dailyTimer('second', 11, 10, 0, 1)
            setInterval(() => {
                if (this.timer.length == 2 && this.onProgress === false) {
                    process.stdout.write(`${this.timer.join(' | ')}\r`)
                    this.timer = []
                }
            }, 5000)


            return true

        } catch (err) {
            console.log(err)
            throw {
                code: 'CFM.init',
                msg: err
            }
        }

    }

    dailyTimer(type, h, m, s, interval) {
        return new Promise((resolve, reject) => {
            let x = {
                hours: h || 0,
                minutes: m || 0,
                seconds: s || 0
            };
            let dtAlarm = new Date();
            dtAlarm.setUTCHours(x.hours);
            dtAlarm.setUTCMinutes(x.minutes);
            dtAlarm.setUTCSeconds(x.seconds);
            let dtNow = new Date();

            if (dtAlarm - dtNow > 0) {
                console.log('Later today, latest notification has been sent already at 9:05 AM today');
            }
            else {

                dtAlarm.setDate(dtAlarm.getDate() + 1);
                console.log('Next Notif tomorrow at :' + dtAlarm);
            }

            let diff = dtAlarm - new Date();
            let secs = diff / 1000
            const counter = setInterval(async () => {
                let remainingSeconds = parseInt(secs % 60);
                if (remainingSeconds < 10) {
                    remainingSeconds = "0" + remainingSeconds;
                }
                const d = secs - remainingSeconds;
                let index
                if (type == 'second')
                    index = 1
                else
                    index = 0
                this.timer[index] = ("[" + type + "] : " + Math.floor(d / 3600) + ":" + Math.floor(d % 3600 / 60) + ":" + remainingSeconds);
                if (secs == 0 || secs < 0 || secs == NaN) {
                    clearInterval(counter)
                    this.type = type
                    await this.daily()
                    this.dailyTimer(type, x.hours, x.minutes, x.seconds, interval);
                } else {
                    secs--;
                }
            }, interval * 1000)
            resolve()
        })

    }
    async fetchAllFiles() {
        return new Promise(async (resolve, reject) => {
            try {
                this.list = await this.getlist() // fetch new list of CSV Files in the FTP
                this.list = this.list.map(l => {
                    l.type = l.name.match(/(?<=_)([a-z]+)(?=_final\.csv)/g)[0]
                    return l
                })
                this.list.sort((a, b) => a.size - b.size)
                let undownlaoded = []
                for (let i in this.list) { // Loop through , to get the non downlaoded files
                    const l = this.list[i]
                    let doc = await this.db.find(l)
                    if (doc.length === 0) {
                        undownlaoded.push([l.name, l.type, l.size])
                    }
                }
                if (undownlaoded.length != 0) {
                    console.log(`there is ${undownlaoded.length} files to be downloaded`)
                    console.log('Start Download at : ' + new Date())
                    for (let j in undownlaoded) {
                        console.log('Downloading [' + j + '] ... [' + undownlaoded[j][0] + '] :: [' + (undownlaoded[j][2] / 1048576).toFixed(2) + ']')
                        await this.extractData(undownlaoded[j][0], undownlaoded[j][1])
                        await blok(1)
                    }
                    console.log('*************  ... DONE downloading ... *************')
                    console.log('Done Download at : ' + new Date())
                }

                resolve()
            } catch (error) {
                reject(error)
            }
        })
    }
    async daily() {
        console.log('\n')
        this.onProgress = true
        this.list = await this.getlist() // fetch new list of CSV Files in the FTP
        await this.fetchAllFiles()
        this.data = await this.db.get() // fetch latest data added to database
        this.data = this.data.filter(l => l.type === this.type)
        for (let i = 0; i < this.data.length; i++) {
            let el = this.data[i]
            const keys = Object.keys(el).filter(l => l !== 'date' && l !== 'size' && l !== 'rows' && l != 'type')
            for (let x = 0; x < keys.length; x++) {
                const l = keys[x]
                if (l !== l.replace(/^"|"$|https:\/\//g, '')) {
                    Object.defineProperty(el, l.replace(/^"|"$|https:\/\//g, ''),
                        Object.getOwnPropertyDescriptor(el, l))
                    delete el[l];
                }
                if (/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/.test(l) === false) {
                    delete el[l];
                }
            }
            // await this.db.update(el)
        }
        let keys = []
        for (let i = 0; i < this.data.length; i++) {
            keys = keys.concat(Object.keys(this.data[i]).filter(l => l !== 'date' && l !== 'size' && l !== 'rows' && l != 'type'))
        }
        keys = [...new Set(keys)]
        this.fields = ['date', 'size', 'rows'].concat(keys)
        this.data.forEach(el => {
            keys.forEach(key => {
                if (el[key] == null) {
                    el[key] = 0
                }
            })
        })
        this.data = this.data.sort((a, b) => compDate(b.date, a.date))
        let Repfilename = `./src/storage/CFM-Report-${timeConverter(Date.now()).replace(/\//g, '-')}-${this.type}-final.csv`
        fs.writeFileSync(Repfilename, this.json2csv(this.data))
        console.log('Report CSV file Created Successfully ! ')
        await this.notif.send(Repfilename, this.type)
        console.log('Notifications  Sent to :: ' + process.env.CFM_RECEIVER_USERS.split(' '))
        console.log('---------------------------------' + timeConverter(Date.now()).replace(/\//g, '-') + '----------------------------------')
        this.onProgress = false
    }

    async extractData(name, type) {
        this.currentFile.path = '/uploadsWorten/' + name
        const file = this.list.filter(l => l.name === this.currentFile.path.split('/').pop())[0]

        this.currentFile.size = file.size
        let json = await this.file2Json(this.currentFile.path, this.currentFile.size)
        json.type = type

        this.setCurrentFile(json)
        await this.db.addOrUpdate(this.getRepport())
        await this.db.save()
    }

    setCurrentFile(fileData) {
        const file = this.list.filter(l => l.name === this.currentFile.path.split('/').pop())[0]

        this.currentFile.size = file.size
        this.currentFile.date = timeConverter(file.modifyTime)
        this.currentFile.rows = fileData.length
        this.currentFile.type = fileData.type
        this.currentFile.data = fileData // ->
            .map(l => l.Website.match(/(?<=www\.)((.*?)\.[a-z]{2,3})/) ? l.Website.match(/(?<=www\.)((.*?)\.[a-z]{2,3})/)[0] : l.Website)
        let obj = {}
        const data = this.currentFile.data
        for (let i = 0; i < data.length; i++) {
            data[i] = data[i].replace(/\\""|"\\"/g, '"')
            if (obj[data[i]])
                obj[data[i]] += 1
            else
                obj[data[i]] = 1
        }
        this.currentFile.data = obj
        return this.currentFile
    }

    getRepport() {
        this.rapport = {
            date: this.currentFile.date,
            size: (this.currentFile.size / 1048576).toFixed(2),
            rows: this.currentFile.rows,
            type: this.currentFile.type,
            ...this.currentFile.data
        }
        return this.rapport
    }
    connect() {
        return new Promise((resolve, reject) => {
            this.sftp.connect({
                host: process.env.CFM_HOST,
                port: process.env.CFM_PORT || 22,
                username: process.env.CFM_USER,
                password: process.env.CFM_PASS,
                keepaliveInterval: 2000,
                keepaliveCountMax: 20
            })
                .then(() => resolve())
                .catch(err => reject(err))
        })
    }

    getlist() {
        return new Promise((resolve, reject) => {
            this.sftp.list("/uploadsWorten")
                .then(list => resolve(list.filter(l =>
                    l.name.includes(this.type) &&
                    l.name.endsWith('.csv'))
                    .map(l => {
                        const { name, size, modifyTime } = l
                        return { name, size, modifyTime, date: timeConverter(l.modifyTime) }
                    })))
                .catch(err => reject(err))
        })
    }

    get(path, size) {
        return new Promise((resolve, reject) => {
            let ws = new Progress(size, resolve)
            this.sftp.get(path, ws, { autoClose: false })
        })
    }

    toJSON(buffer) {
        return new Promise((resolve, reject) => {
            csv({ "delimiter": ";" })
                .fromString(buffer.toString())
                .then(json => resolve(json))
                .catch(err => reject(err))
        })
    }

    file2Json(path, size) {
        return new Promise(async (resolve, reject) => {
            try {
                const file = await this.get(path, size)
                const json = await this.toJSON(file)
                resolve(json)
            } catch (err) {
                reject(err)
            }
        })
    }

    json2csv(jsonObj) {
        const opts = { fields: this.fields };
        try {
            const parser = new Parser(opts);
            return parser.parse(jsonObj)
        } catch (err) {
            console.error(err);
            throw err
        }
    }
}

let CFM = new CRAWLO_FTP_MONITOR()
CFM.init()