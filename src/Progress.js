
import Stream from 'stream'

export default class Progress extends Stream {
    constructor(size, callback) {
        super()
        this.size = size
        this.callback = callback
        this.readable = true;
        this.bytes = 0;
        this.buff = null
    }
    write(buf) {
        this.buff += buf
        this.bytes += buf.length;
        process.stdout.write(`Downloading ... [${(this.bytes / 1048576).toFixed(2)}/${(this.size / 1048576).toFixed(2)} MB] [${((this.bytes * 100) / this.size).toFixed(2)} %]\r`);
    }
    end(buf) {
        if (arguments.length) this.write(buf);
        this.writable = false;
        this.callback(this.buff)

    }
    once(buf) {
        if (arguments.length) this.write(buf);
        this.writable = false;
    }
}