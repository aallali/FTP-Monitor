
import  nodemailer from 'nodemailer'

export default   class Notification {
    constructor(config) {
        this.config = config
        this.smtpTrans = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: {
                user: this.config.GMAIL,
                pass: this.config.PASS
            },
            tls: {
                // do not fail on invalid certs
                rejectUnauthorized: false
            }
        })
        this.mailOptions = {
            from: this.config.GMAIL,
            to: this.config.Receiver_users,
            subject: ``,
            text: ``,//TODO:
            attachments: [
                {
                    path: 'file_path'
                }
                ]
        }

    }
    send(attachment, type) {
         this.config.TYPE = type
        this.mailOptions.subject= `Crawlo FTP Monitor | ${this.config.TYPE} Final | Daily Check`,
        this.mailOptions.text= `this is an official Report  of the daily FTP excels monitoring ,  ${this.config.TYPE} Final `,
        this.mailOptions.attachments[0].path = attachment
        return new Promise((resolve, reject) => {
            this.smtpTrans.sendMail(this.mailOptions, (err, res) => {
                err ? reject(err) : resolve()
            })
        })

    }


}