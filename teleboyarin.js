'use strict';

const TelegramBot = require('node-telegram-bot-api'),
      rp = require('request-promise'),
      Redis = require('ioredis'),
      config = require('./config.json'),
      npm = require('./package.json'),
      raven = require('raven');

if (process.env.SENTRY_DSN) {
    const sentry = new raven.Client(process.env.SENTRY_DSN);
    sentry.patchGlobal();
}

if (process.env.TELEGRAM_TOKEN) config.token = process.env.TELEGRAM_TOKEN;

const request = rp.defaults({headers: {
    'User-Agent': `Teleboyarin/${npm.version}`,
    Accept: 'application/json'
}});

const redis = process.env.REDIS_PORT ? new Redis(process.env.REDIS_PORT) : (config.redis ? new Redis(config.redis) : new Redis());

var workers = {};

function getWorker(process, userId) {
    if (!(process.id in workers)) workers[process.id] = {};
    if (userId in workers[process.id]) return new Promise((resolve, reject) => resolve(workers[process.id][userId]));
    const workerGetReq = `${config.apiURL}/processes/${process.id}/workers/tagged/telegram${userId}`,
          workerPostReq = `${config.apiURL}/processes/${process.id}/workers`;
    return new Promise((resolve, reject) =>
        request.get(workerGetReq).
            then((worker) => resolve(workers[process.id][userId] = JSON.parse(worker))).
            catch((err) => err.statusCode !== 404 ? reject(err) : request.post(workerPostReq, {form: {tags: `telegram${userId}`}})).
                then((worker) => resolve(workers[process.id][userId] = JSON.parse(worker))).
                catch((err) => reject(err))
    );
}

const whiteList = process.env.MTSAR_PROCESSES ? process.env.MTSAR_PROCESSES.split(',') : config.processes;

function filterProcesses(processes) {
    return whiteList ? processes.filter((process) => whiteList.indexOf(process.id) > -1) : processes;
}

const bot = new TelegramBot(config.token, {
    polling: true
});

bot.on('text', onText);

function onText(msg) {
    const text = msg.text.trim();

    if (!!config.disabled) {
        bot.sendMessage(msg.chat.id, 'I am relaxing.');
        return;
    }

    redis.get(msg.from.id).then((raw) => {
        const state = raw ? JSON.parse(raw) : undefined;

        if (text == '/cancel') {
            const reply = state ? `Cancelling the ${state.text} operation.` : 'Cancelling nothing.';
            const markup = JSON.stringify({hide_keyboard: true});
            redis.del(msg.from.id).then(() => bot.sendMessage(msg.chat.id, reply, {reply_markup: markup}));
        } else {
            switch (!!state ? state.text : undefined) {
                case '/annotate':        stateAnnotate(text, msg, state);       break;
                case '/annotate/answer': stateAnnotateAnswer(text, msg, state); break;
                case '/process':         stateProcess(text, msg, state);        break;
                default:                 stateInitial(text, msg, state);        break;
            }
        }
    });
}

function stateInitial(text, msg, state) {
    switch (text) {
        case '/start':
            bot.sendMessage(msg.chat.id, `Hi, ${msg.from.first_name}!`);
        break;
        case '/version':
            request.get(`${config.apiURL}/version`).then((body) => {
                const reply = `Mechanical Tsar v${body}`;
                bot.sendMessage(msg.chat.id, reply);
            });
        break;
        case '/processes':
            request.get(`${config.apiURL}/processes`).then((body) => {
                const processes = filterProcesses(JSON.parse(body));
                if (processes.length > 0) {
                    const reply = processes.map((process) => `*${process.id}*: ${process.description}`).join("\n");
                    bot.sendMessage(msg.chat.id, reply, {parse_mode: 'Markdown'});
                } else {
                    const reply = "No processes.";
                    bot.sendMessage(msg.chat.id, reply, {parse_mode: 'Markdown'});
                }
            });
        break;
        case '/process':
        case '/annotate':
            request.get(`${config.apiURL}/processes`).then((body) => {
                const processes = filterProcesses(JSON.parse(body));
                const reply = 'Which one?';
                const markup = JSON.stringify({
                      keyboard: processes.map((process) => [process.id]),
                      one_time_keyboard: true
                });
                bot.sendMessage(msg.chat.id, reply, {reply_markup: markup}).then(() => {
                    redis.set(msg.from.id, JSON.stringify({text: text, processes: processes}));
                });
            });
        break;
        default:
        break;
    }
}

function stateProcess(text, msg, state) {
    const process = state.processes.find((p) => p.id == text);
    if (process) {
        const processReq = request.get(`${config.apiURL}/processes/${text}`),
              workersReq = request.get(`${config.apiURL}/processes/${text}/workers`),
              tasksReq   = request.get(`${config.apiURL}/processes/${text}/tasks`),
              answersReq = request.get(`${config.apiURL}/processes/${text}/answers`);
        Promise.all([processReq, workersReq, tasksReq, answersReq]).then((responses) => {
            const process = JSON.parse(responses[0]),
                  workers = JSON.parse(responses[1]).length,
                  tasks   = JSON.parse(responses[2]).length,
                  answers = JSON.parse(responses[3]).length;
            const reply = `[${process.description}](${processReq.uri.href})\n*Workers:* ${workers}.\n*Tasks:* ${tasks}.\n*Answers:* ${answers}.`;
            const markup = JSON.stringify({hide_keyboard: true});
            redis.del(msg.from.id).then(() => bot.sendMessage(msg.chat.id, reply, {parse_mode: 'Markdown', reply_markup: markup}));
        });
    }
}

function stateAnnotate(text, msg, state) {
    const process = state.processes.find((p) => p.id == text);
    if (process) {
        getWorker(process, msg.from.id).then((worker) => {
            request.get(`${config.apiURL}/processes/${process.id}/workers/${worker.id}/task`).then((response) => {
                if (!response || 0 === response.length) {
                    const reply = 'Thank you, but this process has already been finished.';
                    const markup = JSON.stringify({hide_keyboard: true});
                    redis.del(msg.from.id).then(() => bot.sendMessage(msg.chat.id, reply, {parse_mode: 'Markdown', reply_markup: markup}));
                } else {
                    const allocation = JSON.parse(response);
                    const task = allocation.tasks[0];
                    const reply = task.description;
                    const markup = JSON.stringify({
                          keyboard: task.answers.map((answer) => [answer]).concat([['/stop']]),
                          one_time_keyboard: true
                    });
                    bot.sendMessage(msg.chat.id, reply, {parse_mode: 'Markdown', reply_markup: markup}).then(() => {
                        redis.set(msg.from.id, JSON.stringify({text: '/annotate/answer', process: process, worker: worker, task: task}));
                    });
                }
            });
        });
    }
}

function stateAnnotateAnswer(text, msg, state) {
    switch (text) {
        case '/stop': {
            const reply = 'Thank you for your help!';
            const markup = JSON.stringify({hide_keyboard: true});
            redis.del(msg.from.id).then(() => bot.sendMessage(msg.chat.id, reply, {reply_markup: markup}));
        }
        break;
        default:
            if (state.task.answers.indexOf(text) > -1) {
                const process = state.process, worker = state.worker, task = state.task;
                const answers = {}; answers[`answers[${task.id}]`] = text;
                request.patch(`${config.apiURL}/processes/${process.id}/workers/${worker.id}/answers`, {form: answers}).then((response) => {
                    const reply = 'Your answer has been recorded!';
                    const markup = JSON.stringify({hide_keyboard: true});
                    bot.sendMessage(msg.chat.id, reply, {parse_mode: 'Markdown', reply_markup: markup}).then(() => {
                        const stateNew = {text: process.id, processes: [process]};
                        redis.set(msg.from.id, JSON.stringify(stateNew)).then(() => {
                            stateAnnotate(stateNew.text, msg, stateNew);
                        });
                    });
                });
            }
        break;
    }
}
