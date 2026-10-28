const API_BASE_URL = '/api';

class ApiClient {
  constructor() {
    this.token = null;
  }

  setToken(token) {
    this.token = token;
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const config = {
      ...options,
      headers,
    };

    try {
      const response = await fetch(url, config);

      if (response.status === 401) {
        // Token expired or invalid
        localStorage.removeItem('token');
        this.token = null;
        window.location.href = '/login';
        throw new Error('Session expired. Please login again.');
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'An error occurred');
      }

      return data;
    } catch (error) {
      if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
        throw new Error('Unable to connect to server. Please check your connection.');
      }
      throw error;
    }
  }

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  }

  post(endpoint, data) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  put(endpoint, data) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }

  // Download file (PDF)
  async downloadFile(endpoint, filename) {
    const url = `${API_BASE_URL}${endpoint}`;

    const headers = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, { headers });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Download failed');
      }

      // Prefer the server's file name (backups: .db on the old server, .sql.gz on Cloudflare)
      const serverName = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1];
      this.saveFile(await response.blob(), serverName || filename);
    } catch (error) {
      throw error;
    }
  }

  // GET that returns null when the server has no such route: the old
  // (Express) server answers unknown routes with the app's HTML page
  async getIfAvailable(endpoint) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });

    if (!(response.headers.get('Content-Type') || '').includes('application/json')) {
      return null;
    }
    if (response.status === 401) {
      return this.request(endpoint, { method: 'GET' });
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'An error occurred');
    }
    return data;
  }

  // Save a Blob as a file download
  saveFile(blob, filename) {
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(downloadUrl);
  }
}

const api = new ApiClient();

export default api;

// Utility functions
export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export function formatDate(dateString) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateInput(dateString) {
  if (!dateString) return '';
  return dateString.split('T')[0];
}

export function generateWhatsAppLink(phone, message) {
  let cleanPhone = phone?.replace(/[\s\-\(\)]/g, '') || '';

  if (!cleanPhone.startsWith('+') && !cleanPhone.startsWith('91')) {
    cleanPhone = '91' + cleanPhone;
  } else if (cleanPhone.startsWith('+')) {
    cleanPhone = cleanPhone.substring(1);
  }

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

export function getStatusColor(status) {
  switch (status) {
    case 'paid':
    case 'success':
    case 'active':
      return 'badge-success';
    case 'pending':
    case 'warning':
      return 'badge-warning';
    case 'overdue':
    case 'danger':
    case 'inactive':
      return 'badge-danger';
    default:
      return 'badge-info';
  }
}
