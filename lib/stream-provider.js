import Cinemeta from './util/cinemeta.js';
import DebridLink from './debrid-link.js';
import RealDebrid from './real-debrid.js';
import AllDebrid, { ADDON_URL } from './all-debrid.js';
import Premiumize from './premiumize.js';
import TorBox from './torbox.js';
import { BadRequestError } from './util/error-codes.js';
import { FILE_TYPES } from './util/file-types.js';
import { encode } from 'urlencode';

// Validate environment variables
if (!process.env.ADDON_URL && !ADDON_URL) {
    throw new Error('ADDON_URL environment variable or constant is missing');
}

const STREAM_NAME_MAP = {
    debridlink: "[DL+] DebridSearch",
    realdebrid: "[RD+] DebridSearch",
    alldebrid: "[AD+] DebridSearch",
    premiumize: "[PM+] DebridSearch",
    torbox: "[TB+] DebridSearch"
};

async function getMovieStreams(config, type, id) {
    const cinemetaDetails = await Cinemeta.getMeta(type, id);
    if (!cinemetaDetails.name) {
        console.error(`Cinemeta failed for ID ${id}:`, cinemetaDetails);
        return [];
    }
    const searchKey = cinemetaDetails.name;
    console.log(`getMovieStreams: ID=${id}, SearchKey=${searchKey}, Year=${cinemetaDetails.year}`);

    let apiKey = config.DebridLinkApiKey || config.DebridApiKey;
    if (!apiKey) {
        console.error('No API key provided for Debrid provider');
        return [];
    }

    if (config.DebridProvider === "RealDebrid") {
        let results = [];
        const torrents = await RealDebrid.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`searchTorrents failed for ${searchKey}:`, err);
            return [];
        });
        //console.log(`Found torrents:`, torrents.map(t => ({ id: t.id, name: t.name, links: t.links || 'none' })));
        if (torrents && torrents.length) {
            const streams = await Promise.all(torrents
                .filter(torrent => filterYear(torrent, cinemetaDetails))
                .map(torrent => {
                    return RealDebrid.getTorrentDetails(apiKey, torrent.id)
                        .then(torrentDetails => {
                            if (!torrentDetails.videos || torrentDetails.videos.length === 0) {
                                console.warn(`No videos for torrent ${torrent.id}: ${torrent.name}`);
                                return null;
                            }
                            return toStream(torrentDetails, type);
                        })
                        .catch(err => {
                            console.error(`Error fetching details for ${torrent.id}: ${torrent.name}`, err);
                            return null;
                        });
                }));
            results.push(...streams.filter(stream => stream));
        }

        const downloads = await RealDebrid.searchDownloads(apiKey, searchKey, 0.3).catch(err => {
            console.error(`searchDownloads failed for ${searchKey}:`, err);
            return [];
        });
        //console.log(`Found downloads:`, downloads.map(d => ({ id: d.id, name: d.name })));
        if (downloads && downloads.length) {
            const streams = await Promise.all(downloads
                .filter(download => filterYear(download, cinemetaDetails))
                .map(download => {
                    return toStream(download, type);
                }));
            results.push(...streams.filter(stream => stream));
        }
        console.log(`RealDebrid Final streams for ${searchKey}:`, results.map(s => s.title));
        return results;
    } else if (config.DebridLinkApiKey || config.DebridProvider === "DebridLink") {
        const torrents = await DebridLink.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`DebridLink searchTorrents failed:`, err);
            return [];
        });
        if (torrents && torrents.length) {
            const torrentIds = torrents
                .filter(torrent => filterYear(torrent, cinemetaDetails))
                .map(torrent => torrent.id);

            if (torrentIds && torrentIds.length) {
                return await DebridLink.getTorrentDetails(apiKey, torrentIds.join())
                    .then(torrentDetailsList => {
                        return torrentDetailsList.map(torrentDetails => toStream(torrentDetails));
                    })
                    .catch(err => {
                        console.error(`DebridLink getTorrentDetails failed:`, err);
                        return [];
                    });
            }
        }
    } else if (config.DebridProvider === "AllDebrid") {
        let results = [];
        const items = await AllDebrid.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`AllDebrid searchTorrents failed:`, err);
            return [];
        });
        if (items && items.length) {
            const streams = await Promise.all(
                items
                    .filter(item => filterYear(item, cinemetaDetails))
                    .map(async item => {
                        try {
                            if (item.type === 'direct') {
                                const hostUrl = item.url;
                                const url = `${ADDON_URL}/resolve/AllDebrid/${apiKey}/${encode(item.id)}/${encode(hostUrl)}`;
                                return toStream({
                                    source: 'alldebrid',
                                    id: item.id,
                                    name: item.name,
                                    type: 'direct',
                                    videos: [{ url: url, name: item.name, size: item.size, info: item.info }],
                                    size: item.size,
                                    info: item.info
                                }, type);
                            } else {
                                const torrentDetails = await AllDebrid.getTorrentDetails(apiKey, item.id);
                                if (!torrentDetails) {
                                    console.warn(`Skipping AllDebrid torrent ${item.id}: No valid data`);
                                    return null;
                                }
                                return toStream(torrentDetails);
                            }
                        } catch (err) {
                            console.error(`AllDebrid ${item.type} error for ${item.id}:`, err);
                            return null;
                        }
                    })
            );
            results.push(...streams.filter(stream => stream));
        }
        console.log(`AllDebrid final streams for ${searchKey}:`, results.map(s => s.title));
        return results;
    } else if (config.DebridProvider === "Premiumize") {
        const files = await Premiumize.searchFiles(apiKey, searchKey, 0.3).catch(err => {
            console.error(`Premiumize searchFiles failed:`, err);
            return [];
        });
        if (files && files.length) {
            const streams = await Promise.all(
                files
                    .filter(file => filterYear(file, cinemetaDetails))
                    .map(torrent => {
                        return Premiumize.getTorrentDetails(apiKey, torrent.id)
                            .then(torrentDetails => toStream(torrentDetails))
                            .catch(err => {
                                console.error(`Premiumize getTorrentDetails failed for ${torrent.id}:`, err);
                                return null;
                            });
                    })
            );
            console.log(`Premiumize final streams for ${searchKey}:`, streams.filter(s => s).map(s => s.title));
            return streams.filter(stream => stream);
        }
    } else if (config.DebridProvider === "TorBox") {
        const torrents = await TorBox.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`TorBox searchTorrents failed:`, err);
            return [];
        });
        if (torrents && torrents.length) {
            const streams = await Promise.all(
                torrents
                    .filter(torrent => filterYear(torrent, cinemetaDetails))
                    .map(torrentDetails => toStream(torrentDetails))
            );
            console.log(`TorBox final streams for ${searchKey}:`, streams.filter(s => s).map(s => s.title));
            return streams.filter(stream => stream);
        }
    } else {
        console.error(`Invalid DebridProvider: ${config.DebridProvider}`);
        return Promise.reject(BadRequestError);
    }

    return [];
}

async function getSeriesStreams(config, type, id) {
    const [imdbId, season, episode] = id.split(":");
    const cinemetaDetails = await Cinemeta.getMeta(type, imdbId);
    if (!cinemetaDetails.name) {
        console.error(`Cinemeta failed for ID ${imdbId}:`, cinemetaDetails);
        return [];
    }
    const searchKey = cinemetaDetails.name;
    console.log(`getSeriesStreams: ID=${imdbId}, SearchKey=${searchKey}, Season=${season}, Episode=${episode}`);

    let apiKey = config.DebridLinkApiKey || config.DebridApiKey;
    if (!apiKey) {
        console.error('No API key provided for Debrid provider');
        return [];
    }

    if (config.DebridProvider === "RealDebrid") {
        let results = [];
        const torrents = await RealDebrid.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`RealDebrid searchTorrents failed for ${searchKey}:`, err);
            return [];
        });
        //console.log(`Found torrents:`, torrents.map(t => ({ id: t.id, name: t.name, links: t.links || 'none' })));
        if (torrents && torrents.length) {
            const streams = await Promise.all(torrents
                .filter(torrent => filterSeason(torrent, season))
                .map(torrent => {
                    return RealDebrid.getTorrentDetails(apiKey, torrent.id)
                        .then(torrentDetails => {
                            if (!torrentDetails.videos || torrentDetails.videos.length === 0) {
                                console.warn(`No videos for torrent ${torrent.id}: ${torrent.name}`);
                                return null;
                            }
                            if (filterEpisode(torrentDetails, season, episode)) {
                                return toStream(torrentDetails, type);
                            }
                            return null;
                        })
                        .catch(err => {
                            console.error(`Error fetching details for ${torrent.id}: ${torrent.name}`, err);
                            return null;
                        });
                }));
            results.push(...streams.filter(stream => stream));
        }

        const downloads = await RealDebrid.searchDownloads(apiKey, searchKey, 0.3).catch(err => {
            console.error(`RealDebrid searchDownloads failed for ${searchKey}:`, err);
            return [];
        });
        //console.log(`Found downloads:`, downloads.map(d => ({ id: d.id, name: d.name })));
        if (downloads && downloads.length) {
            const streams = await Promise.all(downloads
                .filter(download => filterDownloadEpisode(download, season, episode))
                .map(download => {
                    return toStream(download, type);
                }));
            results.push(...streams.filter(stream => stream));
        }
        console.log(`RealDebrid Final streams for ${searchKey}:`, results.map(s => s.title));
        return results;
    } else if (config.DebridLinkApiKey || config.DebridProvider === "DebridLink") {
        const torrents = await DebridLink.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`DebridLink searchTorrents failed:`, err);
            return [];
        });
        if (torrents && torrents.length) {
            const torrentIds = torrents
                .filter(torrent => filterSeason(torrent, season))
                .map(torrent => torrent.id);

            if (torrentIds && torrentIds.length) {
                return DebridLink.getTorrentDetails(apiKey, torrentIds.join())
                    .then(torrentDetailsList => {
                        return torrentDetailsList
                            .filter(torrentDetails => filterEpisode(torrentDetails, season, episode))
                            .map(torrentDetails => toStream(torrentDetails, type));
                    })
                    .catch(err => {
                        console.error(`DebridLink getTorrentDetails failed:`, err);
                        return [];
                    });
            }
        }
    } else if (config.DebridProvider === "AllDebrid") {
        let results = [];
        const items = await AllDebrid.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`AllDebrid searchTorrents failed:`, err);
            return [];
        });
        if (items && items.length) {
            const streams = await Promise.all(items
                .filter(item => filterSeason(item, season))
                .map(async item => {
                    try {
                        if (item.type === 'direct') {
                            const hostUrl = item.url;
                            const url = `${ADDON_URL}/resolve/AllDebrid/${apiKey}/${encode(item.id)}/${encode(hostUrl)}`;
                            if (filterDownloadEpisode(item, season, episode)) {
                                return toStream({
                                    source: 'alldebrid',
                                    id: item.id,
                                    name: item.name,
                                    type: 'direct',
                                    videos: [{ url: url, name: item.name, size: item.size, info: item.info }],
                                    size: item.size,
                                    info: item.info
                                }, type);
                            }
                        } else {
                            const torrentDetails = await AllDebrid.getTorrentDetails(apiKey, item.id);
                            if (!torrentDetails) {
                                console.warn(`Skipping AllDebrid torrent ${item.id}: No valid data`);
                                return null;
                            }
                            if (filterEpisode(torrentDetails, season, episode)) {
                                return toStream(torrentDetails, type);
                            }
                        }
                    } catch (err) {
                        console.error(`AllDebrid ${item.type} error for ${item.id}:`, err);
                        return null;
                    }
                }));
            results.push(...streams.filter(stream => stream));
        }
        console.log(`AllDebrid final streams for ${searchKey}:`, results.map(s => s.title));
        return results;
    } else if (config.DebridProvider === "Premiumize") {
        const torrents = await Premiumize.searchFiles(apiKey, searchKey, 0.3).catch(err => {
            console.error(`Premiumize searchFiles failed:`, err);
            return [];
        });
        if (torrents && torrents.length) {
            const streams = await Promise.all(torrents
                .filter(torrent => filterSeason(torrent, season))
                .map(torrent => {
                    return Premiumize.getTorrentDetails(apiKey, torrent.id)
                        .then(torrentDetails => {
                            if (filterEpisode(torrentDetails, season, episode)) {
                                return toStream(torrentDetails, type);
                            }
                            return null;
                        })
                        .catch(err => {
                            console.error(`Premiumize getTorrentDetails failed for ${torrent.id}:`, err);
                            return null;
                        });
                })
            );
            console.log(`Premiumize final streams for ${searchKey}:`, streams.filter(s => s).map(s => s.title));
            return streams.filter(stream => stream);
        }
    } else if (config.DebridProvider === "TorBox") {
        const torrents = await TorBox.searchTorrents(apiKey, searchKey, 0.3).catch(err => {
            console.error(`TorBox searchTorrents failed:`, err);
            return [];
        });
        if (torrents && torrents.length) {
            const streams = await Promise.all(
                torrents
                    .filter(torrent => filterEpisode(torrent, season, episode))
                    .map(torrentDetails => toStream(torrentDetails, type))
            );
            console.log(`TorBox final streams for ${searchKey}:`, streams.filter(s => s).map(s => s.title));
            return streams.filter(stream => stream);
        }
    } else {
        console.error(`Invalid DebridProvider: ${config.DebridProvider}`);
        return Promise.reject(BadRequestError);
    }

    return [];
}

async function resolveUrl(debridProvider, debridApiKey, itemId, hostUrl, clientIp) {
    if (debridProvider === "DebridLink" || debridProvider === "Premiumize") {
        return hostUrl;
    } else if (debridProvider === "RealDebrid") {
        return RealDebrid.unrestrictUrl(debridApiKey, hostUrl, clientIp).catch(err => {
            console.error(`RealDebrid unrestrictUrl failed for ${itemId}:`, err);
            throw err;
        });
    } else if (debridProvider === "AllDebrid") {
        return AllDebrid.unrestrictUrl(debridApiKey, hostUrl).catch(err => {
            console.error(`AllDebrid unrestrictUrl failed for ${itemId}:`, err);
            throw err;
        });
    } else if (debridProvider === "TorBox") {
        return TorBox.unrestrictUrl(debridApiKey, itemId, hostUrl, clientIp).catch(err => {
            console.error(`TorBox unrestrictUrl failed for ${itemId}:`, err);
            throw err;
        });
    } else {
        console.error(`Invalid debridProvider for resolveUrl: ${debridProvider}`);
        return Promise.reject(BadRequestError);
    }
}

function filterSeason(torrent, season) {
    return torrent?.info?.season == season || torrent?.info?.seasons?.includes(Number(season));
}

function filterEpisode(torrentDetails, season, episode) {
    if (!torrentDetails.videos) {
        console.warn(`No videos in torrentDetails for filtering: ${torrentDetails.id}`);
        return false;
    }
    torrentDetails.videos = torrentDetails.videos
 .filter(video => (season == video.info?.season) && (episode == video.info?.episode));
    return torrentDetails.videos && torrentDetails.videos.length;
}

function filterYear(torrent, cinemetaDetails) {
    if (torrent?.info?.year && cinemetaDetails?.year) {
        const matches = torrent.info.year == cinemetaDetails.year;
        console.log(`filterYear: Torrent=${torrent.name}, TorrentYear=${torrent.info.year}, CinemetaYear=${cinemetaDetails.year}, Matches=${matches}`);
        return matches;
    }
    return true;
}

function filterDownloadEpisode(download, season, episode) {
    return download?.info?.season == season && download?.info?.episode == episode;
}

function toStream(details, type) {
    if (!details) {
        console.log('toStream: Received null details, skipping');
        return null;
    }
    let video, icon;
    if (details.type === 'direct' || details.fileType == FILE_TYPES.DOWNLOADS) {
        icon = '⬇️';
        if (!details.videos || details.videos.length === 0) {
            console.log(`toStream: No videos for download ${details.id}: ${details.name}`);
            video = {
                url: details.url,
                name: details.name,
                size: details.size,
                info: details.info
            };
        } else {
            video = details.videos[0];
        }
    } else {
        icon = '💾';
        if (!details.videos || details.videos.length === 0) {
            console.log(`toStream: No videos for torrent ${details.id}: ${details.name}`);
            return null;
        }
        video = details.videos.sort((a, b) => (b.size || 0) - (a.size || 0))[0];
    }

    let title = details.name;
    if (type === 'series') {
        title = title + '\n' + (video?.name || 'Unknown');
    }
    title = title + '\n' + icon + ' ' + formatSize(video?.size);

    let name = STREAM_NAME_MAP[details.source] || details.source;
    const resolution = (video?.info?.resolution) || (details.info?.resolution) || 'Unknown';
    name = name + '\n' + resolution;

    let bingeGroup = details.source + '|' + details.id;

    const stream = {
        name,
        title,
        url: video?.url || '',
        behaviorHints: {
            bingeGroup: bingeGroup
        }
    };
    console.log(`toStream: Created stream for ${details.id}: ${stream.title}`);
    return stream;
}

function formatSize(size) {
    if (!size) {
        return 'Unknown';
    }
    const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
    return Number((size / Math.pow(1024, i)).toFixed(2)) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
}

export default { getMovieStreams, getSeriesStreams, resolveUrl };