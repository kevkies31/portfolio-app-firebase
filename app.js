import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc,
  query, orderBy
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { firebaseConfig, OWNER_EMAIL } from './firebase-config.js';

const CATEGORIES = ['Web', 'Systems', 'Brand / Logo', 'Automation'];

// ---------- Page elements ----------
const mainEl = document.querySelector('#main');
const formCard = document.querySelector('#form-card');
const form = document.querySelector('#project-form');
const formTitle = document.querySelector('#form-title');
const idInput = document.querySelector('#project-id');
const titleInput = document.querySelector('#title');
const categoryInput = document.querySelector('#category');
const descriptionInput = document.querySelector('#description');
const tagsInput = document.querySelector('#tags');
const linkInput = document.querySelector('#link');
const imageInput = document.querySelector('#image-url');
const cancelBtn = document.querySelector('#cancel-btn');
const searchInput = document.querySelector('#search');
const listEl = document.querySelector('#project-list');
const countEl = document.querySelector('#count');
const tabsEl = document.querySelector('#tabs');
const authBtn = document.querySelector('#auth-btn');
const authStatus = document.querySelector('#auth-status');

let activeCategory = 'All';
let all = [];        // every project, newest first
let owner = false;   // true only for the owner's account

function escapeHTML(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ---------- Firebase setup ----------
if (firebaseConfig.apiKey.startsWith('PASTE')) {
  listEl.innerHTML = '<p class="empty">Open firebase-config.js and paste your Firebase settings.</p>';
  throw new Error('Firebase config not filled in');
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const projectsRef = collection(db, 'projects');

// ---------- Login (owner only) ----------
function isOwner(user) {
  return Boolean(
    user && user.emailVerified && user.email &&
    user.email.toLowerCase() === OWNER_EMAIL.toLowerCase()
  );
}

authBtn.addEventListener('click', async () => {
  try {
    if (auth.currentUser) {
      await signOut(auth);
    } else {
      await signInWithPopup(auth, new GoogleAuthProvider());
    }
  } catch (err) {
    alert(err.message);
  }
});

onAuthStateChanged(auth, (user) => {
  owner = isOwner(user);
  formCard.hidden = !owner;
  mainEl.classList.toggle('viewer', !owner);
  authBtn.textContent = user ? 'Sign out' : 'Owner sign in';

  if (!user) {
    authStatus.textContent = '';
  } else if (owner) {
    authStatus.textContent = `Signed in as ${user.email}`;
  } else {
    authStatus.textContent = `${user.email} is not the owner (view only)`;
  }

  if (!owner) resetForm();
  render();
});

// ---------- Tabs ----------
function tabLabel(name) {
  return name === 'All' ? 'All work' : name;
}

function renderTabs() {
  const names = ['All', ...CATEGORIES];
  tabsEl.innerHTML = names.map((name) => `
    <button type="button" class="tab ${name === activeCategory ? 'active' : ''}"
            data-tab="${escapeHTML(name)}">${escapeHTML(tabLabel(name))}</button>
  `).join('');
}

tabsEl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-tab]');
  if (!button) return;
  activeCategory = button.dataset.tab;
  renderTabs();
  render();
});

function fillCategoryOptions() {
  CATEGORIES.forEach((name) => categoryInput.add(new Option(name, name)));
}

// ---------- Form helpers ----------
function readForm() {
  return {
    title: titleInput.value.trim(),
    category: categoryInput.value,
    description: descriptionInput.value.trim(),
    tags: tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean),
    link: linkInput.value.trim(),
    imageUrl: imageInput.value.trim()
  };
}

function startEdit(project) {
  idInput.value = project.id;
  titleInput.value = project.title;
  categoryInput.value = project.category;
  descriptionInput.value = project.description || '';
  tagsInput.value = (project.tags || []).join(', ');
  linkInput.value = project.link || '';
  imageInput.value = project.imageUrl || '';
  formTitle.textContent = 'Edit project';
  cancelBtn.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  form.reset();
  idInput.value = '';
  formTitle.textContent = 'Add a project';
  cancelBtn.hidden = true;
}

// ---------- Read ----------
async function loadAll() {
  try {
    const snap = await getDocs(query(projectsRef, orderBy('createdAt', 'desc')));
    all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    all = [];
    listEl.innerHTML = `<p class="empty">Could not load projects: ${escapeHTML(err.message)}</p>`;
    countEl.textContent = '';
    return false;
  }
  return true;
}

function render() {
  const text = searchInput.value.trim().toLowerCase();

  let list = activeCategory === 'All'
    ? all
    : all.filter((p) => p.category === activeCategory);

  if (text) {
    list = list.filter((p) =>
      (p.title || '').toLowerCase().includes(text) ||
      (p.tags || []).some((t) => t.toLowerCase().includes(text))
    );
  }

  countEl.textContent = `${list.length} project(s)`;

  if (list.length === 0) {
    listEl.innerHTML = '<p class="empty">No projects yet.</p>';
    return;
  }

  listEl.innerHTML = list.map((p) => `
    <article class="project">
      ${(p.imageUrl || '').startsWith('https://')
        ? `<img class="thumb" src="${escapeHTML(p.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : ''}
      <span class="badge">${escapeHTML(p.category)}</span>
      <h3>${escapeHTML(p.title)}</h3>
      <p>${escapeHTML(p.description)}</p>
      <p class="tags">${(p.tags || []).map((t) => `<span>#${escapeHTML(t)}</span>`).join('')}</p>
      ${(p.link || '').startsWith('http')
        ? `<a href="${escapeHTML(p.link)}" target="_blank" rel="noopener">View project</a>`
        : ''}
      ${owner ? `
        <div class="actions">
          <button data-action="edit" data-id="${escapeHTML(p.id)}">Edit</button>
          <button data-action="delete" data-id="${escapeHTML(p.id)}" class="danger">Delete</button>
        </div>` : ''}
    </article>
  `).join('');
}

async function refresh() {
  if (await loadAll()) render();
}

// ---------- Create / Update / Delete ----------
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!owner) return;

  const data = readForm();
  if (data.imageUrl && !data.imageUrl.startsWith('https://')) {
    alert('The thumbnail URL must start with https://');
    return;
  }

  try {
    const id = idInput.value;
    if (id) {
      await updateDoc(doc(db, 'projects', id), data);
    } else {
      await addDoc(projectsRef, { ...data, createdAt: Date.now() });
    }
  } catch (err) {
    alert(err.message);
    return;
  }

  resetForm();
  await refresh();
});

listEl.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || !owner) return;

  const id = button.dataset.id;

  if (button.dataset.action === 'edit') {
    startEdit(all.find((p) => p.id === id));
  }

  if (button.dataset.action === 'delete' && confirm('Delete this project?')) {
    try {
      await deleteDoc(doc(db, 'projects', id));
    } catch (err) {
      alert(err.message);
      return;
    }
    await refresh();
  }
});

cancelBtn.addEventListener('click', resetForm);
searchInput.addEventListener('input', render);

// ---------- Start ----------
fillCategoryOptions();
renderTabs();
refresh();
