// Required modules
const Client = require("ssh2-sftp-client");
const csv = require("csvtojson");
const {Parser} = require('json2csv');
const DB = require('./db').DB
const Notif = require('./notification').default
const fs = require('fs')
const dotenv = require('dotenv');

dotenv.config();

let hostName = process.env.CFM_HOST;
let userName = process.env.CFM_USER;
let password = process.env.CFM_PASS;
let port = process.env.CFM_PORT;

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

class CRAWLO_FTP_MONITOR {
    constructor() {
        this.sftp = new Client();
        this.db = new DB()
        this.notif = new Notif({
            GMAIL: process.env.CFM_GMAIL,
            PASS: process.env.CFM_GMAIL_PASS,
            Receiver_users: process.env.CFM_RECEIVER_USERS.split(' ')
        })
        this.dailyinterval = 12 * 3600 * 1000
        this.type = 'first'; // ['first' || 'second' || '']   '' <= for both
        this.data = []
        this.list = []
        this.currentFile = {
            path: '/uploadsWorten/file_name_here', size: 0, rows: 0, date: 0, data: []
        }
        this.rapport = {}
        this.fields = ['date', 'size', 'rows']
        this.calcInterval()
    }


    async init() {
        try {
            await this.connect()
            this.list = await this.getlist()
            // console.log(this.list.map(l => [l.name, (l.size / 1048576).toFixed(0)]))
            await this.daily()
            setInterval(async () => {
                await this.daily()
            }, this.dailyinterval)
            return true

        } catch (err) {
            console.log(err)
            throw {
                code: 'CFM.init',
                msg: err
            }
        }

    }

    async calcInterval() {
        this.dailyinterval = parseInt(process.env.CFM_DAILYINTERVAL) * 3600000
    }

    async daily() {
        this.list = await this.getlist() // fetch new list of CSV Files in the FTP
        for (let i in this.list) { // Loop through it to get the non downlaoded files
            const l = this.list[i]
            let doc = await this.db.find(l.date)
            if (doc.length === 0) {
                console.log('Downloading ... ' + l.name + ' :: ' + (l.size / 1048576).toFixed(2))
                await this.extractData(l.name)
                console.log('File added :: ' + l.name)
            }
        }
        console.log('Cleaning data fetched...')
        this.data = this.db.get() // fetch latest data added to database
        for (let i = 0; i < this.data.length; i++) {
            let el = this.data[i]
            const keys = Object.keys(el).filter(l => l !== 'date' && l !== 'size' && l !== 'rows')
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
            await this.db.update(el)
        }

        let keys = []
        for (let i = 0; i < this.data.length; i++) {
            keys = keys.concat(Object.keys(this.data[i]).filter(l => l !== 'date' && l !== 'size' && l !== 'rows'))
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
        console.log('Cleaning done.')
        console.log('Sorting the final report Data by date DESC ...')
        this.data = this.data.sort((a, b) => compDate(b.date, a.date))
        console.log('Creating the Report CSV file ...')
        let Repfilename = './src/storage/CFM-Report-' + timeConverter(Date.now()).replace(/\//g, '-') + '.csv'
        fs.writeFileSync(Repfilename, this.json2csv(this.data))
        console.log('Report CSV file Created Successfully !')
        await this.notif.send(Repfilename)
        console.log('Notifications  Sent to :: ' + process.env.CFM_RECEIVER_USERS.split(' '))
        console.log('---------------------------------' +  timeConverter(Date.now()).replace(/\//g, '-') + '----------------------------------')
    }

    async extractData(name) {
        this.currentFile.path = '/uploadsWorten/' + name
        let json = await this.file2Json(this.currentFile.path)
        this.setCurrentFile(json)
        await this.db.addOrUpdate(this.getRepport())
        await this.db.save()
    }

    setCurrentFile(fileData) {
        const file = this.list.filter(l => l.name === this.currentFile.path.split('/').pop())[0]

        this.currentFile.size = file.size
        this.currentFile.date = timeConverter(file.modifyTime)
        this.currentFile.rows = fileData.length
        this.currentFile.data = fileData
            .map(l => l.Website.match(/(?<=www\.)((.*?)\.[a-z]{2,3})/) ? l.Website.match(/(?<=www\.)((.*?)\.[a-z]{2,3})/)[0] : l.Website)
        let obj = {}
        const data = this.currentFile.data
        for (let i = 0; i < data.length; i++) {
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
            ...this.currentFile.data
        }
        return this.rapport
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.sftp.connect({
                host: hostName,
                port: port,
                username: userName,
                password: password,
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
                        const {name, size, modifyTime} = l
                        return {name, size, modifyTime, date: timeConverter(l.modifyTime)}
                    })))
                .catch(err => reject(err))
        })
    }

    get(path) {
        return new Promise((resolve, reject) => {
            this.sftp.get(path)
                .then(file => resolve(file))
                .catch(err => reject(err))
        })
    }

    toJSON(buffer) {
        return new Promise((resolve, reject) => {
            csv({"delimiter": ";"})
                .fromString(buffer.toString())
                .then(json => resolve(json))
                .catch(err => reject(err))
        })
    }

    file2Json(path) {
        return new Promise(async (resolve, reject) => {
            try {
                const file = await this.get(path)
                const json = await this.toJSON(file)
                resolve(json)
            } catch (err) {
                reject(err)
            }
        })
    }

    json2csv(jsonObj) {
        // const { parseAsync } = require('json2csv');

        const opts = {fields: this.fields};
        try {

            const parser = new Parser(opts);
            // parseAsync(jsonObj, opts)
            //     .then(csv => console.log(csv))
            //     .catch(err => console.error(err));
            return parser.parse(jsonObj)
        } catch (err) {
            console.error(err);
            throw err
        }
    }


}

let CFM = new CRAWLO_FTP_MONITOR()
CFM.init()


