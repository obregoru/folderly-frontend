// Fake data for the UX-v2 mockup. No backend — everything lives in memory
// for the lifetime of the session so the user can click through and feel
// the flow without touching real jobs.

export const sampleDrafts = [
  {
    id: 'm-1',
    name: 'Poppy & Thyme birthday reel',
    updatedAt: '2h ago',
    fileCount: 5,
    thumb: 'https://picsum.photos/seed/ppthyme/200/280',
  },
  {
    id: 'm-2',
    name: 'Workshop behind-the-scenes',
    updatedAt: 'yesterday',
    fileCount: 3,
    thumb: 'https://picsum.photos/seed/workshop/200/280',
  },
  {
    id: 'm-3',
    name: 'Untitled draft',
    updatedAt: '3d ago',
    fileCount: 1,
    thumb: null,
  },
]

export const sampleClips = [
  { id: 'c-1', name: 'IMG_9336.mov', size: '14.6 MB', duration: 6.2, trimStart: 1.2, trimEnd: 4.8, speed: 1.0, thumb: 'https://picsum.photos/seed/c1/80/140' },
  { id: 'c-2', name: 'IMG_9342.mov', size: '19.0 MB', duration: 8.5, trimStart: 0, trimEnd: 5.5, speed: 1.5, thumb: 'https://picsum.photos/seed/c2/80/140' },
  { id: 'c-3', name: 'IMG_9345.mov', size: '6.2 MB', duration: 4.0, trimStart: 0.3, trimEnd: 4.0, speed: 2.0, thumb: 'https://picsum.photos/seed/c3/80/140' },
  { id: 'c-4', name: 'IMG_9327.mov', size: '3.4 MB', duration: 3.5, trimStart: 0, trimEnd: 3.5, speed: 1.0, thumb: 'https://picsum.photos/seed/c4/80/140' },
]

export const sampleChannels = [
  { key: 'tiktok', label: 'TikTok', icon: 'TT', enabled: true, customized: false },
  { key: 'ig_reel', label: 'Instagram Reel', icon: 'IG', enabled: true, customized: false },
  { key: 'fb_reel', label: 'Facebook Reel', icon: 'FB', enabled: false, customized: false },
  { key: 'yt_shorts', label: 'YouTube Shorts', icon: 'YT', enabled: true, customized: true },
  { key: 'blog', label: 'Blog post', icon: 'BL', enabled: false, customized: false },
  { key: 'gbp', label: 'Google Business', icon: 'GBP', enabled: false, customized: false },
]
