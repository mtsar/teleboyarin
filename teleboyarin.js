var TelegramBot = require('node-telegram-bot-api'),
    request = require('request'),
    config = require('./config.json'),
    raven = require('raven');

if (process.env.TELEGRAM_TOKEN) config.token = process.env.TELEGRAM_TOKEN;

var bot = new TelegramBot(config.token, {
    polling: true
});

bot.on('text', onText);

function onText(msg) {
    var chatId = msg.chat.id, messageId = msg.message_id;
    var suffix = msg.text.split(' '), prefix = suffix.shift();
    console.log(msg);

    switch (prefix) {
        case '/start':
            bot.sendMessage(chatId, 'Hi, ' + msg.from.first_name + '!');
            break;
        case '/version':
            request.get(`${config.apiURL}/version`, function(err, data, body) {
                var reply = `Mechanical Tsar v${body}`;
                bot.sendMessage(chatId, reply, {reply_to_message_id: messageId});
            });
            break;
        case '/processes':
            request.get(`${config.apiURL}/processes`, function(err, data, body) {
                var processes = JSON.parse(body);
                var reply = processes.map(process => `*${process.id}*: ${process.description}`).join("\n");
                bot.sendMessage(chatId, reply, {reply_to_message_id: messageId, parse_mode: 'Markdown'});
            });
            break;
        default:
            break;
    }
}
