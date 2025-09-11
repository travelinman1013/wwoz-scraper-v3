function normalize(input) {
    return input
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\((feat\.|featuring|with)[^)]+\)/g, ' ')
        .replace(/\b(feat\.|featuring|with)\b.*$/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function tokenize(input) {
    return normalize(input)
        .split(' ')
        .filter(Boolean);
}
function jaccard(aTokens, bTokens) {
    const a = new Set(aTokens);
    const b = new Set(bTokens);
    let inter = 0;
    for (const t of a)
        if (b.has(t))
            inter++;
    const union = a.size + b.size - inter;
    if (union === 0)
        return 0;
    return inter / union;
}
function charSimilarity(a, b) {
    // Simple character overlap ratio as a lightweight fuzzy proxy
    const sa = new Set(a);
    const sb = new Set(b);
    let inter = 0;
    for (const ch of sa)
        if (sb.has(ch))
            inter++;
    const union = sa.size + sb.size - inter;
    return union === 0 ? 0 : inter / union;
}
function scoreText(a, b) {
    const tScore = jaccard(tokenize(a), tokenize(b));
    const cScore = charSimilarity(normalize(a), normalize(b));
    // Blend token-level and char-level similarity
    return (tScore * 0.7 + cScore * 0.3);
}
export class SongMatcher {
    static score(song, track) {
        const artistText = song.artist || '';
        const titleText = song.title || '';
        const trackArtist = track.artists.join(' & ');
        const artistScore = scoreText(artistText, trackArtist);
        const titleScore = scoreText(titleText, track.name);
        // Optional minor duration regularization if we have it
        let durationFactor = 1;
        if (track.durationMs && track.durationMs > 0) {
            // Very loose penalty if wildly off typical song length windows
            // Without scraped duration, keep this gentle.
            const minutes = track.durationMs / 60000;
            if (minutes < 1.5 || minutes > 7)
                durationFactor = 0.98;
        }
        const combined = (artistScore * 0.6 + titleScore * 0.4) * durationFactor;
        return {
            track,
            confidence: Math.max(0, Math.min(100, combined * 100)),
            reason: `artist=${(artistScore * 100).toFixed(1)} title=${(titleScore * 100).toFixed(1)}`,
        };
    }
}
