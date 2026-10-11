import axios from "axios";

const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_BASE_URL || ""}/api`,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json"
  }
});

let csrfToken = null;

api.interceptors.request.use(async config => {
    const method = (config.method || "get").toLowerCase();

    if (
      ["post", "put", "patch", "delete"].includes(method) &&
      config.url !== "/auth/csrf"
    ) {
      if (!csrfToken) {
        const response = await api.get("/auth/csrf");
        csrfToken = response.data.token;
      }

      config.headers = config.headers || {};
      config.headers["X-CSRF-TOKEN"] = csrfToken;
    }

    return config;
});

api.interceptors.response.use(
    response => response,
    error => {
      const status = error.response?.status;
      const data = error.response?.data;

      if (status === 401) {
        error.userMessage = "Please sign in to continue.";
      } else if (status === 403) {
        error.userMessage = "This action is not allowed for your account.";
      } else if (status === 404) {
        error.userMessage = "That record could not be found.";
      } else if (status === 409) {
        error.userMessage =
          data?.message ||
          "That time or change conflicts with current records.";
      } else if (status === 400) {
        error.userMessage =
          data?.message ||
          "Check the form details and try again.";
      } else {
        error.userMessage =
          data?.message ||
          "LabSlot could not complete the request.";
      }

      if (status === 401 || status === 403) {
        csrfToken = null;
      }

      return Promise.reject(error);
    }
);

export function resetCsrfToken() {
  csrfToken = null;
}

export default api;