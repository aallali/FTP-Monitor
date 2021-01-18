
const nodemailer = require('nodemailer');

exports.default = class Notification {
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
            subject: `Crawlo FTP Monitor | Daily Check`,
            text: `this a test of the daily FTP excels monitor mail `,//TODO:
            attachments: [
                {
                    path: 'file_path'
                }
                ]
        }

    }
    //lakil@crawlo sarah@crawlo omar@crawlo
    send(attachment) {
        this.mailOptions.attachments[0].path = attachment
        return new Promise((resolve, reject) => {
            this.smtpTrans.sendMail(this.mailOptions, (err, res) => {
                err ? reject(err) : resolve()
            })
        })

    }


}