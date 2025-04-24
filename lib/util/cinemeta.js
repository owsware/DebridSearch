import fetch from 'node-fetch';

async function getMeta(type, imdbId, retries = 5, delay = 1000) {
    if (!type || !imdbId) {
        throw new Error('Type and IMDb ID are required');
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, 5000); // 5-second timeout per attempt

        try {
            const response = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`, {
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok) {
                throw new Error(`Failed to fetch metadata (Status: ${response.status})`);
            }
            const body = await response.json();
            return body?.meta || null;
        } catch (err) {
            clearTimeout(timeout);
            const isTimeout = err.code === 'ETIMEDOUT' || err.name === 'AbortError';
            const errorMessage = isTimeout
                ? `Connection to Cinemeta API timed out`
                : `Failed to fetch metadata: ${err.message}`;
            
            if (attempt < retries) {
                console.warn(`Attempt ${attempt} of ${retries}: ${errorMessage}. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(`All ${retries} attempts failed: ${errorMessage}`);
                throw new Error(
                    isTimeout
                        ? 'Unable to reach Cinemeta API after multiple attempts. Please try again later.'
                        : `Unable to fetch metadata from Cinemeta: ${err.message}`
                );
            }
        }
    }
}

export default { getMeta };
