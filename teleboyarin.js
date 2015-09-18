const TelegramBot = require('node-telegram-bot-api'),
      rp = require('request-promise'),
      config = require('./config.json'),
      raven = require('raven'),
      repl = require('repl');

if (process.env.SENTRY_DSN) new raven.Client(process.env.SENTRY_DSN).patchGlobal();

if (process.env.TELEGRAM_TOKEN) config.token = process.env.TELEGRAM_TOKEN;

const request = rp.defaults({headers: { 'Accept': 'application/json' }});

var workers = {}, state = {};

function getWorker(process, userId) {
    if (userId in workers) return new Promise((resolve, reject) => resolve(workers[userId]));
    const workerGetReq = `${config.apiURL}/processes/${process.id}/workers/tagged/telegram${userId}`,
          workerPostReq = `${config.apiURL}/processes/${process.id}/workers`;
    return new Promise((resolve, reject) =>
        request.get(workerGetReq).
            then((worker) => resolve(workers[userId] = JSON.parse(worker))).
            catch((err) => err.statusCode != 404 ? reject(err) : request.post(workerPostReq, {form: {tags: `telegram${userId}`}})).
                then((worker) => resolve(workers[userId] = JSON.parse(worker))).
                catch((err) => reject(err))
    );
}

const bot = new TelegramBot(config.token, {
    polling: true
});

bot.on('text', onText);

function onText(msg) {
    const userId = msg.from.id, chatId = msg.chat.id, messageId = msg.message_id;
    const text = msg.text.trim();

    if (!!config.disabled) {
        bot.sendMessage(chatId, 'I am relaxing.');
        return;
    }

    function stateInitial(text) {
        switch (text) {
            case '/start':
                bot.sendMessage(chatId, 'Hi, ' + msg.from.first_name + '!');
                break;
            case '/version':
                request.get(`${config.apiURL}/version`).then(body => {
                    const reply = `Mechanical Tsar v${body}`;
                    bot.sendMessage(chatId, reply);
                });
                break;
            case '/processes':
                request.get(`${config.apiURL}/processes`).then(body => {
                    const processes = JSON.parse(body);
                    const reply = processes.map(process => `*${process.id}*: ${process.description}`).join("\n");
                    bot.sendMessage(chatId, reply, {parse_mode: 'Markdown'});
                });
                break;
            case '/process':
            case '/annotate':
                request.get(`${config.apiURL}/processes`).then(body => {
                    const processes = JSON.parse(body);
                    const reply = 'Which one?';
                    const markup = JSON.stringify({
                          keyboard: processes.map(process => [process.id]),
                          one_time_keyboard: true
                    });
                    bot.sendMessage(chatId, reply, {reply_markup: markup}).
                        then(() => state[userId] = {text: text, processes: processes});
                });
                break;
            default:
                break;
        }
    }

    function stateProcess(text) {
        switch (text) {
            default:
                const processReq = request.get(`${config.apiURL}/processes/${text}`),
                      workersReq = request.get(`${config.apiURL}/processes/${text}/workers`),
                      tasksReq   = request.get(`${config.apiURL}/processes/${text}/tasks`),
                      answersReq = request.get(`${config.apiURL}/processes/${text}/answers`);
                Promise.all([processReq, workersReq, tasksReq, answersReq]).then(responses => {
                    const process = JSON.parse(responses[0]),
                          workers = JSON.parse(responses[1]).length,
                          tasks   = JSON.parse(responses[2]).length,
                          answers = JSON.parse(responses[3]).length;
                    const reply = `[${process.description}](${processReq.uri.href})\n*Workers:* ${workers}.\n*Tasks:* ${tasks}.\n*Answers:* ${answers}.`;
                    const markup = JSON.stringify({hide_keyboard: true});
                    bot.sendMessage(chatId, reply, {parse_mode: 'Markdown', reply_markup: markup});
                });
                break;
        }
        delete state[userId];
    }

    function stateAnnotate(text) {
        switch (text) {
            default:
                const process = state[userId].processes.find((p) => p.id == text);
                if (process) {
                    getWorker(process, userId).then((worker) => {
                        request.get(`${config.apiURL}/processes/${process.id}/workers/${worker.id}/task`).then((response) => {
                            const allocation = JSON.parse(response);
                            const task = allocation.tasks[0];
                            const reply = task.description;
                            const markup = JSON.stringify({
                                  keyboard: task.answers.map((answer) => [answer]).concat([['/stop']]),
                                  one_time_keyboard: true
                            });
                            bot.sendMessage(chatId, reply, {parse_mode: 'Markdown', reply_markup: markup}).
                                then(() => state[userId] = {text: '/annotate/answer', process: process, worker: worker, task: task});
                        })
                    });
                }
                break;
        }
    }

    function stateAnnotateAnswer(text) {
        switch (text) {
            case '/stop':
                const reply = 'Thank you for your service!';
                const markup = JSON.stringify({hide_keyboard: true});
                bot.sendMessage(chatId, reply, {reply_markup: markup});
                delete state[userId];
                break;
            default:
                const process = state[userId].process, worker = state[userId].worker, task = state[userId].task;
                if (task.answers.indexOf(text) > -1) {
                    const answers = {}; answers[`answers[${task.id}]`] = text;
                    request.patch(`${config.apiURL}/processes/${process.id}/workers/${worker.id}/answers`, {form: answers}).then(response => {
                        const reply = 'Your answer has been recorded!';
                        const markup = JSON.stringify({hide_keyboard: true});
                        bot.sendMessage(chatId, reply, {parse_mode: 'Markdown', reply_markup: markup}).then(() => {
                            state[userId] = {text: process.id, processes: [process]};
                            stateAnnotate(state[userId].text);
                        });
                    });
                }
                break;
        }
    }

    if (text == '/cancel') {
        const reply = !!state[userId] ? `Cancelling the ${state[userId].text} operation.` : 'Cancelling nothing.';
        const markup = JSON.stringify({hide_keyboard: true});
        bot.sendMessage(chatId, reply, {reply_markup: markup});
        delete state[userId];
    }

    switch (!!state[userId] ? state[userId].text : undefined) {
        case '/annotate':
            stateAnnotate(text);
            break;
        case '/annotate/answer':
            stateAnnotateAnswer(text);
            break;
        case '/process':
            stateProcess(text);
            break;
        default:
            stateInitial(text);
            break;
    }
}
