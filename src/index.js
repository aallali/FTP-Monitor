// Required modules
const Client = require("ssh2-sftp-client");
const csv = require("csvtojson");
const {Parser} = require('json2csv');
const DB = require('./db').DB
const fs = require('fs')
const dotenv = require('dotenv');
dotenv.config();

let hostName = process.env.CFM_HOST;
let userName = process.env.CFM_USER;
let password = process.env.CFM_PASS;
let port     = process.env.CFM_PORT;
 function timeConverter(UNIX_timestamp) {
    const a = new Date(UNIX_timestamp);
    return a.getDate() + '/' + (a.getMonth() + 1) + '/' + a.getFullYear();
}

class CRAWLO_FTP_MONITOR {
    constructor() {
        this.sftp = new Client();
        this.type = 'first'; // ['first' || 'second' || ''] <= for both
        this.list = []
        this.db = new DB()
        this.currentFile = {
            path: '/uploadsWorten/file_name_here', size: 0, rows: 0, date: 0, data: []
        }
        this.rapport = {
            today: {},
            previous: {}
        }
        this.fields = ['date', 'size', 'rows']
        //console.log(this.db.get())

    }

    async init() {
        try {

            await this.connect()
            this.list = await this.getlist()
            //console.log(this.list.map(l => [l.name,(l.size / 1048576).toFixed(0)]))
            let dt = this.db.get()
            let keys = []
            for (let i in dt) {
                // console.log(Object.keys(dt[i]).filter(l => l !== 'date' && l !== 'size' && l !== 'rows'))
                keys = keys.concat(Object.keys(dt[i]).filter(l => l !== 'date' && l !== 'size' && l !== 'rows'))
            }
            keys = [...new Set(keys)]
            this.fields = this.fields.concat(keys)
            dt.forEach(el => {

                keys.forEach(key => {
                    if (el[key] == null) {
                        el[key] = 0
                    }
                })
            })

            function compDate(d1, d2) {
                d1 = d1.split('/').map(l => parseInt(l))
                d2 = d2.split('/').map(l => parseInt(l))
                if (d1 === d2)
                    return 0
                else {
                    if (d1[2] == d2[2]) {
                        if (d1[1] == d2[1]) {
                            if (d1[0] == d2[0]) {
                                return 0
                            } else return d1[0] - d2[0]
                        } else return d1[1] - d2[1]
                    } else return d1[2] - d2[2]
                }
            }

            dt = dt.sort((a, b) => compDate(b.date, a.date))
            fs.writeFileSync('./src/CFM-Report-'+timeConverter(Date.now()).replace(/\//g, '-')+'.csv', this.json2csv(dt))
            // let csvStr = this.json2csv(dt)
            // csv()
            //     .fromString(csvStr)
            //     .then((csvRow)=>{
            //        // console.log(csvRow) // => [["1","2","3"], ["4","5","6"], ["7","8","9"]]
            //     })
            // for (let i = 0; i < dt.length; i++) {
            //     let el = dt[i]
            //     let keys = Object.keys(el).filter(l => l !== 'date' && l !== 'size' && l !== 'rows')
            //     keys.map(l => {
            //         if(l === '') {
            //             Object.defineProperty(el, 'null',
            //                 Object.getOwnPropertyDescriptor(el, l));
            //             delete el[l];
            //         }
            //         else if (l !== l.replace(/^"|"$|https:\/\//g, '')) {
            //             Object.defineProperty(el, l.replace(/^"|"$|https:\/\//g, ''),
            //                 Object.getOwnPropertyDescriptor(el, l));
            //             delete el[l];
            //         }
            //     })
            //     await this.db.addOrUpdate(el)
            // }
            // console.log('Cleaning done.')


            //this.setup()


        } catch (err) {
            console.log(err)
            throw {
                code: 'CFM.connection',
                msg: err
            }
        }

    }

    async genRapport() {

    }

    async daily() {
        // this.lastFile = this.list.sort(
        //     (a, b) => b.modifyTime > a.modifyTime || -(b.modifyTime < a.modifyTime)
        // )[0].name;
        //this.currentFile.path = '/uploadsWorten/' + this.lastFile
        //this.fields = Object.keys(this.rapport.today)
        this.setCurrentFile(await this.file2Json(this.currentFile.path))
        this.db.addOrUpdate(this.getRepport().today)
        this.db.save()
    }

    async setup() {

        for (let i in this.list) {
            const l = this.list[i]
            let doc = await this.db.find(l.date)
            if (doc.length === 0) {
                console.log('On ...' + (l.size / 1048576).toFixed(2))
                await this.extractData(l.name)
                console.log(':: File added :: ' + l.name)
            } else console.log('== > already handled == >' + l.name)
        }


    }

    async extractData(name) {
        this.currentFile.path = '/uploadsWorten/' + name
        let json = await this.file2Json(this.currentFile.path)
        this.setCurrentFile(json)
        await this.db.addOrUpdate(this.getRepport().today)
        await this.db.save()
    }

    setCurrentFile(fileData) {
        const file = this.list.filter(l => l.name === this.currentFile.path.split('/').pop())[0]

        this.currentFile.size = file.size
        this.currentFile.date = timeConverter(file.modifyTime)
        this.currentFile.rows = fileData.length
        this.currentFile.data = fileData
            .map(l => l.Website.match(/(?<=www\.)((.*?)\.[a-z]{2,3})/) ? l.Website.match(/(?<=www\.)((.*?)\.[a-z]{2,3})/)[0] : l.Website)
        console.log(fileData.length)
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
        this.rapport.today = {
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
        console.log(opts)
        try {

            const parser = new Parser(opts);
            const csv = parser.parse(jsonObj);
            // parseAsync(jsonObj, opts)
            //     .then(csv => console.log(csv))
            //     .catch(err => console.error(err));
            return csv
        } catch (err) {
            console.error(err);
            throw err
        }
    }


}

let CFM = new CRAWLO_FTP_MONITOR()
CFM.init()


