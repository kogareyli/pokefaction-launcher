/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

const pkg = require('../package.json');
const nodeFetch = require("node-fetch");
const convert = require('xml-js');
let url = pkg.user ? `${pkg.url}/${pkg.user}` : pkg.url

let config = `${url}/config`;
let articles = `${url}/articles`;

class Config {
    GetConfig() {
        return new Promise((resolve, reject) => {
            nodeFetch(`${config}?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } }).then(async config => {
                if (config.status === 200) return resolve(config.json());
                else return reject({ error: { code: config.statusText, message: 'server not accessible' } });
            }).catch(error => {
                return reject({ error });
            })
        })
    }

    async getInstanceList() {
        let urlInstance = `${url}/instances`
        let instances = await nodeFetch(urlInstance).then(res => res.json()).catch(err => err)
        let instancesList = []
        instances = Object.entries(instances)

        for (let [name, data] of instances) {
            let instance = data
            instancesList.push(instance)
        }
        return instancesList
    }

    async getNews(config) {
        if (config.rss) {
            return new Promise((resolve, reject) => {
                nodeFetch(config.rss).then(async config => {
                    if (config.status === 200) {
                        let news = [];
                        let response = await config.text()
                        response = (JSON.parse(convert.xml2json(response, { compact: true })))?.rss?.channel?.item;

                        if (!Array.isArray(response)) response = [response];
                        for (let item of response) {
                            news.push({
                                title: item.title._text,
                                content: item['content:encoded']._text,
                                author: item['dc:creator']._text,
                                publish_date: item.pubDate._text
                            })
                        }
                        return resolve(news);
                    }
                    else return reject({ error: { code: config.statusText, message: 'server not accessible' } });
                }).catch(error => reject({ error }))
            })
        } else {
            return new Promise((resolve, reject) => {
                nodeFetch(articles).then(async config => {
                    if (config.status === 200) return resolve(config.json());
                    else return reject({ error: { code: config.statusText, message: 'server not accessible' } });
                }).catch(error => {
                    return reject({ error });
                })
            })
        }
    }
}

/**
 * Maintenance en cours ? (le PokéFaction Panel met maintenance = true pendant ses mises à jour).
 * Sécurité : si l'heure de fin prévue est dépassée de plus de 20 minutes, on ne bloque plus.
 */
export function enMaintenance(conf) {
    if (!conf || !conf.maintenance) return false;
    const fin = Date.parse(conf.maintenance_fin || '');
    if (!isNaN(fin) && Date.now() > fin + 20 * 60000) return false;
    return true;
}

export function texteMaintenance(conf) {
    const fin = Date.parse(conf?.maintenance_fin || '');
    const heure = isNaN(fin) ? '' : new Date(fin).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return (conf?.maintenance_message || 'Le serveur est en maintenance.') + (heure ? ` Fin prévue vers ${heure}.` : '');
}

export default new Config;