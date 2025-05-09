import { createApp } from "vue";
import { GraffitiLocal } from "@graffiti-garden/implementation-local";
import { GraffitiRemote } from "@graffiti-garden/implementation-remote";
import { GraffitiPlugin } from "@graffiti-garden/wrapper-vue";
import { fileToGraffitiObject } from "@graffiti-garden/wrapper-files";
import { GraffitiGet } from "@graffiti-garden/wrapper-vue";
import { graffitiObjectToFile } from "@graffiti-garden/wrapper-files";

// Reusable ListSection component for displaying lists
const ListSection = {
  props: {
    title: String,
    items: { type: Array, default: () => [] },
    showRemove: { type: Boolean, default: false }
  },
  emits: ["select", "remove"],
  template: `
    <div class="list-section">
      <h2>{{ title }}</h2>
      <ul>
        <li v-for="user in items" :key="user.id" class="user-item">
          <graffiti-get
            v-if="user.iconUrl"
            :url="user.iconUrl"
            v-slot="{ object }"
          >
            <graffiti-object-to-file
              :object="object"
              v-slot="{ fileDataUrl }"
            >
              <img class="list-avatar" :src="fileDataUrl" alt="icon" />
            </graffiti-object-to-file>
          </graffiti-get>

          <!-- fallback if there was no iconUrl or the above fails -->
          <img
            v-else
            class="list-avatar"
            src="./images/profile.png"
            alt="img"
          />

          <span class="list-label" @click="$emit('select', user)">
            {{ user.name }}
          </span>
          <button
            v-if="showRemove"
            class="btn-remove"
            @click="$emit('remove', user.id)"
          >Remove</button>
        </li>
      </ul>
    </div>
  `
};

createApp({
  components: { ListSection, GraffitiGet, graffitiObjectToFile },

  data() {
    return {
      session: null,
      currentTab: "messages",
      friendTab: "list",
      friendOptions: [
        { key: "list",     label: "Friends List",     icon: "images/friendslist.png" },
        { key: "add",      label: "Add Friends",      icon: "images/addfriends.png" },
        { key: "requests", label: "Friend Requests", icon: "images/friendrequests.png" }
      ],
      users: [],
      publicProfiles: [],
      friendObjects: [],
      selectedUser: null,
      selectedChannel: null,
      myMessage: "",
      editingMessage: false,
      editingObject: null,
      searchTerm: "",

      selectedFeature: null,
      myEmoji: "",

      // Profile state
      profileObject: null,
      profileName: "",
      profilePronouns: "",
      profileBio: "",
      profilePicFile: null,
      profilePicPreview: "",
      profilePicUrl: "",
      saved: false,

      // Schemas
      messageSchema: {
        properties: {
          value: {
            required: ["content", "published"],
            properties: { content: { type: "string" }, published: { type: "number" } }
          }
        }
      },
      friendSchema: {
        properties: {
          value: {
            required: ["activity", "target"],
            properties: { activity: { const: "friend" }, target: { type: "string" } }
          }
        }
      },
      profileSchema: {
        properties: {
          value: {
            required: ["describes", "published"],
            properties: {
              describes: { type: "string" },
              name:      { type: "string" },
              pronouns:  { type: "string" },
              bio:       { type: "string" },
              icon:      { type: "string" },
              published: { type: "number" }
            }
          }
        }
      }
    };
  },

  computed: {
    // Users you are mutually friends with
    acceptedFriends() {
      const me = this.session?.actor;
      if (!me) return [];
      const mine = [], theirs = [];
      this.friendObjects.forEach(f => {
        if (!f?.value) return;
        const v = f.value;
        if (f.actor === me && typeof v.target === "string") mine.push(v.target);
        if (v.target === me && typeof f.actor === "string") theirs.push(f.actor);
      });
      return mine
        .filter(id => theirs.includes(id))
        .map(id => ({ id, name: id, iconUrl: null }));
    },

    // Incoming friend requests
    friendRequests() {
      const mine = [], theirs = [];
      this.friendObjects.forEach(f => {
        if (!f?.value) return;
        const v = f.value;
        if (f.actor === this.session.actor && typeof v.target === 'string') mine.push(v.target);
        if (v.target === this.session.actor && typeof f.actor === 'string') theirs.push(f.actor);
      });
      return theirs
        .filter(id => !mine.includes(id))
        .map(id => ({ id, name: id, iconUrl: null }));
    },

    // Sent friend requests
    sentRequests() {
      const mine = [], theirs = [];
      this.friendObjects.forEach(f => {
        if (!f?.value) return;
        const v = f.value;
        if (f.actor === this.session.actor && typeof v.target === 'string') mine.push(v.target);
        if (v.target === this.session.actor && typeof f.actor === 'string') theirs.push(f.actor);
      });
      return mine
        .filter(id => !theirs.includes(id))
        .map(id => ({ id, name: id, iconUrl: null }));
    },

    // Discover users not yet in any friend state
    discoverUsers() {
      const me = this.session?.actor;
      const list = this.publicProfiles.filter(p => (
        p.id !== me &&
        !this.acceptedFriends.some(f => f.id === p.id) &&
        !this.friendRequests.some(f => f.id === p.id) &&
        !this.sentRequests.some(f => f.id === p.id)
      ));
      return list;
    },

    outgoingRequests() {
      return this.friendObjects
        .filter(f => f.actor === this.session.actor)
        .map(f => f.value.target);
    },
    
    filteredUsers() {
      const me = this.session.actor;
      const term = this.searchTerm.toLowerCase().trim();
      return this.publicProfiles.filter(p => p.id !== me)
        .filter(p => !this.acceptedFriends.some(f => f.id === p.id))
        .filter(p => !term || p.name.toLowerCase().includes(term));
    },
  },

  watch: {
    // On login or session change
    "$graffitiSession.value": {
      immediate: true,
      async handler(session) {
        if (!session?.actor) {
          this.session = null;
          return;
        }
        this.session = session;

        // Clear profile form
        this.profileObject = null;
        this.profileName = this.profilePronouns = this.profileBio = "";
        this.profilePicUrl = this.profilePicPreview = "";
        this.profilePicFile = null;

        // Load existing profile
        const profiles = [];
        for await (const obj of this.$graffiti.discover(["designftw-2025-studio2", session.actor], this.profileSchema)) {
          if (obj?.value?.describes === session.actor) profiles.push(obj);
        }
        if (profiles.length) {
          profiles.sort((a, b) => b.value.published - a.value.published);
          const latest = profiles[0];
          this.profileObject     = latest;
          this.profileName       = latest.value.name     || "";
          this.profilePronouns   = latest.value.pronouns || "";
          this.profileBio        = latest.value.bio      || "";
          this.profilePicUrl     = latest.value.icon     || "";
          this.profilePicPreview = this.profilePicUrl;
        }

        // Refresh data
        await this.refreshFriends();
        await this.refreshPublicProfiles();

        // Show only friends in chat user list
        this.users = this.acceptedFriends.map(f => ({
          id:      f.id,
          name:    f.name,
          iconUrl: f.iconUrl
        }));
      }
    },

    // When switching tabs
    currentTab(newTab) {
      if (newTab === 'settings') {
        const v = this.profileObject?.value;
        this.profileName       = v?.name     || "";
        this.profilePronouns   = v?.pronouns || "";
        this.profileBio        = v?.bio      || "";
        this.profilePicUrl     = v?.icon     || "";
        this.profilePicPreview = this.profilePicUrl;
        this.profilePicFile    = null;
      }
    },

    // Keep chat user list in sync
    acceptedFriends(friends) {
      this.users = friends.map(f => ({ id: f.id, name: f.name, iconUrl: f.iconUrl }));
    }
  },

  methods: {
    // Fetch all friend objects
    async refreshFriends() {
      const arr = [];
      for await (const entry of this.$graffiti.discover([this.session.actor], this.friendSchema)) {
        if (entry.object?.value?.target) arr.push(entry.object);
      }
      this.friendObjects = arr;
    },

    // Fetch all public profiles
    async refreshPublicProfiles() {
      const all = [];
      for await (const entry of this.$graffiti.discover(["designftw-2025-studio2"], this.profileSchema)) {
        const obj = entry.object;
        if (obj.value?.describes) all.push(obj);
      }
      const latestMap = {};
      all.forEach(o => {
        const { describes, published } = o.value;
        if (!latestMap[describes] || published > latestMap[describes].value.published) {
          latestMap[describes] = o;
        }
      });
      this.publicProfiles = Object.values(latestMap).map(o => ({
        id:      o.value.describes,
        name:    o.value.name     || o.value.describes,
        iconUrl: o.value.icon     || null
      }));
    },

    // Send a friend request
    async addFriend(targetId) {
      const payload = {
        value: { activity: "friend", target: targetId },
        channels: [ this.session.actor ]
      };
      const res = await this.$graffiti.put(payload, this.session);
  
      await this.refreshFriends();
    },

    // Internal delete helper
    async _deleteSingle({ actor, target }) {
      for (const f of this.friendObjects) {
        if (f.actor === actor && f.value.target === target) {
          await this.$graffiti.delete(f, this.session);
          break;
        }
      }
    },

    // Remove mutual friendship
    async removeFriend(id) {
      await this._deleteSingle({ actor: this.session.actor, target: id });
      await this._deleteSingle({ actor: id, target: this.session.actor });
      await this.refreshFriends();
    },

    // Decline incoming request
    async declineRequest(id) {
      await this._deleteSingle({ actor: id, target: this.session.actor });
      await this.refreshFriends();
    },

    // Cancel sent request
    async cancelRequest(id) {
      await this._deleteSingle({ actor: this.session.actor, target: id });
      await this.refreshFriends();
    },

    // Select a user to chat
    selectUser(user) {
      this.selectedUser = user;
      this.selectedChannel = [this.session.actor, user.id].sort().join("--");
      this.editingMessage = false;
      this.editingObject = null;
      this.myMessage = "";
    },

    // Send a chat message
    async sendMessage() {
      if (!this.myMessage.trim() || !this.selectedChannel) return;
      await this.$graffiti.put(
        { value: { content: this.myMessage.trim(), published: Date.now() }, channels: [this.selectedChannel] },
        this.session
      );
      this.myMessage = "";
    },

    // Start editing a message
    startEdit(msg) {
      this.editingMessage = true;
      this.editingObject = msg;
      this.myMessage = msg.value.content;
      this.$nextTick(() => this.$refs.messageInput.focus());
    },

    // Cancel edit
    cancelEdit() {
      this.editingMessage = false;
      this.editingObject = null;
      this.myMessage = "";
    },

    // Update an edited message
    async updateMessage() {
      if (!this.editingObject || !this.myMessage.trim()) return;
      const updated = {
        ...this.editingObject,
        value: { ...this.editingObject.value, content: this.myMessage.trim(), edited: true, editedAt: Date.now() }
      };
      await this.$graffiti.put(updated, this.session);
      this.cancelEdit();
    },

    // Delete a message
    async deleteMessage(msg) {
      if (confirm("Are you sure you want to delete this message?")) {
        await this.$graffiti.delete(msg, this.session);
        if (this.editingObject?.url === msg.url) this.cancelEdit();
      }
    },

    // Handle profile picture selection
    onProfilePicChange(e) {
      const file = e.target.files[0];
      if (!file) return;
      this.profilePicFile = file;
      this.profilePicPreview = URL.createObjectURL(file);
    },

    // Remove current picture
    removeProfilePic() {
      this.profilePicFile = null;
      this.profilePicUrl = "";
      this.profilePicPreview = "";
    },

    // Save or update profile
    async saveProfile() {
      // Upload new pic if chosen
      if (this.profilePicFile) {
        const obj = await fileToGraffitiObject(this.profilePicFile);
        const { url } = await this.$graffiti.put(obj, this.session);
        this.profilePicUrl = url;
        this.profilePicFile = null;
      }

      // Build profile object
      const payload = {
        ...(this.profileObject || {}),
        value: {
          generator: "https://jackyc-11.github.io/tether/",
          describes: this.session.actor,
          name:      this.profileName,
          pronouns:  this.profilePronouns,
          bio:       this.profileBio,
          icon:      this.profilePicUrl,
          published: Date.now()
        },
        channels: ["designftw-2025-studio2"]
      };

      // Put and store URL if new
      const res = await this.$graffiti.put(payload, this.session);
      if (!this.profileObject && res.url) {
        this.profileObject = { ...payload, url: res.url };
      }

      this.saved = true;
      setTimeout(() => {
        this.saved = false;
      }, 2000);
    }
  }
})
.use(GraffitiPlugin, {
  // graffiti: new GraffitiLocal(),
  graffiti: new GraffitiRemote(),
})
.mount("#app");