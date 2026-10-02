// Images are stored in Supabase Storage with absolute URLs; relative paths
// (e.g. bundled placeholders) are served from this site.
export const getImageUrl = (imagePath) => {
    if (!imagePath) return null;
    return imagePath;
};

export default { getImageUrl };
