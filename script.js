
import { supabase } from "./supabase.js";

let currentUser = null;
let mediaItems = [];

const BUCKET = "media";
const MAX_FILE_SIZE = 8 * 1024 * 1024;

// Navigation
window.showPage = function (pageName) {
  document.querySelectorAll(".page").forEach(page => {
    page.classList.remove("active");
  });

  const page = document.getElementById(pageName);

  if (page) {
    page.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (pageName === "photos" || pageName === "videos") {
    loadMedia();
  }
};

// Check admin permissions from Supabase
async function checkAdmin(user) {
  if (!user) return false;

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error) {
    console.error("Profile check failed:", error.message);
    return false;
  }

  return data.role === "admin";
}

// Login using Supabase Authentication
window.adminLogin = async function () {
  const email = document.getElementById("admin-email").value.trim();
  const password = document.getElementById("admin-password").value;
  const status = document.getElementById("login-status");

  if (!email || !password) {
    status.textContent = "Please enter your email and password.";
    return;
  }

  status.textContent = "Signing in...";

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    status.textContent = "Login failed: " + error.message;
    return;
  }

  const isAdmin = await checkAdmin(data.user);

  if (!isAdmin) {
    await supabase.auth.signOut();
    status.textContent = "This account does not have admin access.";
    return;
  }

  currentUser = data.user;
  showAdminDashboard(true);
  status.textContent = "";
  document.getElementById("admin-password").value = "";

  alert("Welcome to JethalalFile Admin! 🎉");
};

function showAdminDashboard(loggedIn) {
  document.getElementById("login-box").hidden = loggedIn;
  document.getElementById("upload-dashboard").hidden = !loggedIn;
}

window.logoutAdmin = async function () {
  const { error } = await supabase.auth.signOut();

  if (error) {
    alert(error.message);
    return;
  }

  currentUser = null;
  showAdminDashboard(false);
  showPage("home");
};

// Upload files to Supabase Storage
window.uploadMedia = async function () {
  if (!currentUser || !(await checkAdmin(currentUser))) {
    alert("Please login with your admin account.");
    return;
  }

  const input = document.getElementById("media-file");
  const captionInput = document.getElementById("media-caption");
  const status = document.getElementById("upload-status");

  const files = Array.from(input.files);

  if (!files.length) {
    alert("Please select at least one file.");
    return;
  }

  for (const file of files) {
    const validType =
      file.type.startsWith("image/") ||
      file.type.startsWith("video/");

    if (!validType) {
      alert("Only image and video files are allowed.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      alert("Each file must be smaller than 8 MB.");
      return;
    }
  }

  status.textContent = "Uploading your content...";

  try {
    for (const file of files) {
      const extension = file.name.split(".").pop().toLowerCase();
      const fileName = `${crypto.randomUUID()}.${extension}`;
      const filePath = `${currentUser.id}/${fileName}`;

      // Upload file to Storage
      const { error: storageError } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false
        });

      if (storageError) throw storageError;

      // Save media details in database
      const mediaType = file.type.startsWith("video/")
        ? "video"
        : "photo";

      const { error: databaseError } = await supabase
        .from("media")
        .insert({
          owner_id: currentUser.id,
          bucket_path: filePath,
          media_type: mediaType,
          caption: captionInput.value.trim() || file.name,
          published: true
        });

      if (databaseError) {
        // Remove the uploaded object if its database record fails
        await supabase.storage.from(BUCKET).remove([filePath]);
        throw databaseError;
      }
    }

    input.value = "";
    captionInput.value = "";

    status.textContent = "Published successfully! 🎉";

    await loadMedia();

    alert("Your content is now online! ❤️");
  } catch (error) {
    console.error("Upload error:", error);
    status.textContent = "Upload failed: " + error.message;
  }
};

// Create safe media cards
function createCard(item) {
  const card = document.createElement("article");
  card.className = "media-card";

  const media = document.createElement(
    item.media_type === "video" ? "video" : "img"
  );

  const { data } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(item.bucket_path);

  media.src = data.publicUrl;

  if (item.media_type === "video") {
    media.controls = true;
    media.preload = "metadata";
  } else {
    media.alt = item.caption || "JethalalFile photo";
    media.loading = "lazy";
  }

  const content = document.createElement("div");
  content.className = "card-content";

  const caption = document.createElement("p");
  caption.className = "caption";
  caption.textContent = item.caption || "Beautiful memory ❤️";

  content.append(media, caption);
  card.appendChild(content);

  return card;
}

// Load published content from Supabase
async function loadMedia() {
  const { data, error } = await supabase
    .from("media")
    .select("id, bucket_path, media_type, caption, created_at")
    .eq("published", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Gallery error:", error.message);
    return;
  }

  mediaItems = data || [];

  const photos = mediaItems.filter(
    item => item.media_type === "photo"
  );

  const videos = mediaItems.filter(
    item => item.media_type === "video"
  );

  renderList("photo-gallery", photos);
  renderList("video-gallery", videos);

  renderList("home-photos", photos.slice(0, 3));
  renderList("home-videos", videos.slice(0, 3));
}

function renderList(id, items) {
  const container = document.getElementById(id);
  if (!container) return;

  container.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No content yet. Stay tuned! ✨";
    container.appendChild(empty);
    return;
  }

  items.forEach(item => {
    container.appendChild(createCard(item));
  });
}

// Restore login session after refresh
async function initializeWebsite() {
  const { data, error } = await supabase.auth.getSession();

  if (!error && data.session) {
    const user = data.session.user;
    const isAdmin = await checkAdmin(user);

    if (isAdmin) {
      currentUser = user;
      showAdminDashboard(true);
    } else {
      await supabase.auth.signOut();
      showAdminDashboard(false);
    }
  } else {
    showAdminDashboard(false);
  }

  await loadMedia();
}

supabase.auth.onAuthStateChange(() => {
  // Session restoration is handled on initial load.
});

initializeWebsite();
