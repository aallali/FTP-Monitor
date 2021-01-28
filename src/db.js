
import fs from 'fs'
 class DB {

    constructor() {
        this.data =  null
    }
    loadb() {
        return new Promise((resolve, reject) => {
            fs.readFile('./src/storage/db.json', 'utf8', (err, jsonString) => {
                if (err) {
                    reject(err)
                    return
                }
                resolve(JSON.parse(jsonString))
            })
        })
    }
    async get() {
        this.data = await this.loadb()
        return this.data
    }

    add(x) {
        return new Promise((resolve, reject) => {
            this.data.push(x)
            this.save()
                .then((res) => resolve(res))
                .catch((err) => reject(err))
        })
    }

    async find(x) {
        await this.get()
        return this.data.filter(l => l.date == x.date && l.type == x.type);
    }

    delete(x) {
        return new Promise((resolve, reject) => {
            this.data = this.data.filter(l => l.date !== x)
            this.save()
                .then((res) => resolve(res))
                .catch((err) => reject(err))
        })
    }

    update(obj) {
        return new Promise((resolve, reject) => {
            this.data = this.data.map((el) => {
                if (el.date === obj.date)
                    el = obj
                return el
            })
            this.save()
                .then((res) => resolve(res))
                .catch((err) => reject(err))
        })
    }

    save() {
        return new Promise((resolve, reject) => {
            fs.writeFile('./src/storage/db.json', JSON.stringify(this.data), 'utf8', (err) => {
                if (err)
                    reject(err)
                else
                    resolve(this.data)
            });
        })
    }

    addOrUpdate(obj) {
        return new Promise(async (resolve, reject) => {
            try {
                let doc = await this.find(obj.date)
                if (doc.length > 0) {
                    for (let i in this.data) {
                        if (this.data[i].date === obj.date) {
                            this.data[i] = obj
                            break;
                        }
                    }
                    // console.log('Already Found and updated.')
                    resolve(await this.save())
                } else {
                    // console.log('Created new document for the object')
                    resolve(this.add(obj))
                }
            } catch (err) {
                reject(err)
            }
        })
    }

}
 
export default DB