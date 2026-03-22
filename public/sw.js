// Posty Posty Service Worker — push notifications for scheduled posts

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})

// Handle push notifications
self.addEventListener('push', (event) => {
  let data = { title: 'Posty Posty', body: 'You have a scheduled post ready', url: '/' }

  try {
    if (event.data) {
      data = { ...data, ...event.data.json() }
    }
  } catch (e) {
    // fallback to default
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    tag: data.tag || 'posty-notification',
    data: { url: data.url || '/' },
    actions: data.actions || [],
    vibrate: [200, 100, 200],
    requireInteraction: true, // Keep notification visible until user acts
  }

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  )
})

// Handle notification click — open the app to the scheduled post
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url || '/'

  // If an action was clicked
  if (event.action === 'open-tiktok') {
    event.waitUntil(clients.openWindow('https://www.tiktok.com'))
    return
  }
  if (event.action === 'open-app') {
    // Fall through to open app URL
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If the app is already open, focus it and navigate
      for (const client of windowClients) {
        if (client.url.includes('postyposty.com') || client.url.includes('localhost')) {
          client.focus()
          client.postMessage({ type: 'navigate', url })
          return
        }
      }
      // Otherwise open a new window
      return clients.openWindow(url)
    })
  )
})
