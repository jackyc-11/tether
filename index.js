import { createApp } from "vue";
import { GraffitiLocal } from "@graffiti-garden/implementation-local";
import { GraffitiRemote } from "@graffiti-garden/implementation-remote";
import { GraffitiPlugin, GraffitiGet } from "@graffiti-garden/wrapper-vue";
import { fileToGraffitiObject, graffitiObjectToFile, graffitiFileSchema } from "@graffiti-garden/wrapper-files";
import { GraffitiObjectToFile } from "@graffiti-garden/wrapper-files/vue";

// Reusable ListSection component for displaying lists
const ListSection = {
  props: {
    title: String,
    items: { type: Array, default: () => [] },
    showRemove: { type: Boolean, default: false },
    selectedId: { type: String, default: null }
  },
  emits: ["select", "remove"],
  template: `
  <div class="list-section">
    <h2>{{ title }}</h2>
    <ul>
      <li v-for="user in items" :key="user.id" class="user-item" :class="{ selected: user.id === selectedId }" @click="$emit('select', user)">
        <img
          class="list-avatar"
          :src="user.iconUrl || 'images/profile.png'"
          @error="e => (e.target.src = 'images/profile.png')"
          alt="avatar"
        />
        <span class="list-label">
          {{ user.localId || user.name }}
        </span>
        <button
          v-if="showRemove"
          class="btn-remove"
          @click.stop="$emit('remove', user.id)"
        >Remove</button>
      </li>
    </ul>
  </div>
`
};

createApp({
  components: { ListSection, GraffitiGet, GraffitiObjectToFile },

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
      otherEmoji: "",
      showEmojiPicker: false,

      weather: null,
      friendWeather: null,
      location: null,
      friendLocation: null,

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
            properties: { activity: { enum: ["friend","friend_cancel"] }, target: { type: "string" } }
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
      },
      moodSchema: {
        properties: {
          value: {
            required: ["emoji","timestamp"],
            properties: {
              emoji:     { type: "string" },
              timestamp: { type: "number" }
            }
          }
        }
      },
    };
  },

  computed: {
    // Users you are mutually friends with
    acceptedFriends() {
      const me = this.session?.actor;
      if (!me) return [];
      const mine   = new Set();
      const theirs = new Set();
      for (const f of this.friendObjects) {
        if (f.value.activity !== "friend") continue;
  
        const actor  = f.actor;
        const target = f.value.target;
        if (actor === me) mine.add(target);
        if (target === me) theirs.add(actor);
      }
      return [...mine]
      .filter(id => theirs.has(id))
      .map(id => {
        const prof = this.publicProfiles.find(p => p.id === id) || {};
        return {
          id,
          name:    prof.name    || id,
          iconUrl: prof.iconUrl || null,
          localId: prof.localId
        };
      });
    },

    // Incoming friend requests
    friendRequests() {
      const requests = [];
      const cancels = new Set();
  
      for (const f of this.friendObjects) {
        const { activity, target } = f.value;
        // if *you* cancelled, remember it
        if (activity === "friend_cancel" && f.actor === this.session.actor) {
          cancels.add(target);
        }
        // if they sent you a friend request
        if (activity === "friend" && f.actor !== this.session.actor) {
          requests.push(f.actor);
        }
      }
  
      return requests
        .filter(id => !cancels.has(id))
        .filter(id => !this.acceptedFriends.some(f => f.id === id))
        .map(id => {
          const prof = this.publicProfiles.find(p => p.id === id) || {};
          return {
            id,
            name:    prof.name    || id,
            iconUrl: prof.iconUrl || "images/profile.png",
            localId: prof.localId
          };
        });
    },

    // Discover users not yet in any friend state
    discoverUsers() {
      const me = this.session?.actor;
      const list = this.publicProfiles.filter(p => (
        p.id !== me &&
        !this.acceptedFriends.some(f => f.id === p.id) &&
        !this.friendRequests.some(f => f.id === p.id)
      ));
      return list;
    },

    outgoingRequests() {
      return this.friendObjects
        .filter(f => f.actor === this.session.actor
                     && f.value.activity === "friend")
        .map(f => f.value.target)
    },
    
    filteredUsers() {
      const me   = this.session.actor
      const term = this.searchTerm.toLowerCase().trim()
  
      return this.publicProfiles
        .filter(p => p.id !== me)
        .filter(p => !this.acceptedFriends.some(f => f.id === p.id))
        .filter(p => !term || p.localId.toLowerCase().includes(term))
        .sort((a, b) => a.localId.localeCompare(b.localId))
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
        this.profileName = "";
        this.profilePronouns = "";
        this.profileBio = "";
        this.profilePicUrl = "";
        this.profilePicPreview = "";
        this.profilePicFile = null;

        // Load existing profile
        const profiles = [];
        for await (const entry of this.$graffiti.discover(["designftw-2025-studio2", session.actor], this.profileSchema)) {
          const obj = entry.object;
          if (obj?.value?.describes === session.actor) profiles.push(obj);
        }

        if (profiles.length === 0) {
          await this.$graffiti.put({
            value: {
              generator: "https://jackyc-11.github.io/tether/",
              describes: session.actor,
              name:      session.actor.split("/").filter(Boolean).pop(),
              pronouns:  "",
              bio:       "",
              icon:      "",
              published: Date.now()
            },
            channels: ["designftw-2025-studio2", session.actor]
          }, session);
        }
        
        if (profiles.length) {
          profiles.sort((a, b) => (b.value.published || 0) - (a.value.published || 0));
          const latest = profiles[0];
          
          this.profileObject = latest;
          this.profileName = latest.value.name || "";
          this.profilePronouns = latest.value.pronouns || "";
          this.profileBio = latest.value.bio || "";
          this.profilePicUrl = latest.value.icon || "";
          this.profilePicPreview = this.profilePicUrl;
        }

        await this.refreshFriends();
        await this.refreshPublicProfiles();

        this.users = this.acceptedFriends.map(f => ({
          id: f.id,
          name: f.name,
          iconUrl: f.iconUrl,
          localId: f.localId
        }));
      },
    },

    profileName: {
      handler(newVal) {
        this.saveProfile();
      }
    },
    profilePronouns: {
      handler(newVal) {
        this.saveProfile();
      }
    },
    profileBio: {
      handler(newVal) {
        this.saveProfile();
      }
    },

    // When switching tabs
    currentTab(newTab) {
      if (newTab !== 'messages') {
        this.selectedChannel = null;
        this.selectedUser    = null;
        this.selectedFeature = null;
      }
      if (newTab === 'settings') {
        const v = this.profileObject?.value;
        if (v) {
          this.profileName = v.name || "";
          this.profilePronouns = v.pronouns || "";
          this.profileBio = v.bio || "";
          this.profilePicUrl = v.icon || "";
          this.profilePicPreview = this.profilePicUrl;
          this.profilePicFile = null;
        }
      }
    },

    // Keep chat user list in sync
    acceptedFriends(friends) {
      this.users = friends.map(f => ({ id: f.id, name: f.name, iconUrl: f.iconUrl }));
    }
  },

  methods: {
    async getWeatherData() {
      const userCity = ['Boston', 'San Francisco', 'Chicago', 'Miami', 'Seattle'][Math.floor(Math.random() * 5)];
      this.location = { city: userCity };
      
      const friendCity = ['Tokyo', 'London', 'Paris', 'Sydney', 'Berlin'][Math.floor(Math.random() * 5)];
      this.friendLocation = { city: friendCity };
      
      const conditions = ['Clear', 'Cloudy', 'Rain', 'Thunderstorm', 'Snow', 'Mist'];
      
      this.weather = {
        temp: Math.floor(Math.random() * 30) - 5,
        condition: conditions[Math.floor(Math.random() * conditions.length)],
        unit: 'C'
      };
      
      this.friendWeather = {
        temp: Math.floor(Math.random() * 30) - 5,
        condition: conditions[Math.floor(Math.random() * conditions.length)],
        unit: 'C'
      };
    },

    toggleEmojiPicker() {
      this.showEmojiPicker = !this.showEmojiPicker;
      
      if (this.showEmojiPicker) {
        this.$nextTick(() => {
          const picker = new window.EmojiMart.Picker({
            onEmojiSelect: this.onEmojiSelect,
            theme: 'light'
          });
          
          const container = this.$refs.emojiPickerContainer;
          if (container) {
            container.innerHTML = '';
            container.appendChild(picker);
          }
        });
      }
    },
    
    onEmojiSelect(emoji) {
      this.myEmoji = emoji.native;
      this.showEmojiPicker = false;
      this.saveMyMoodEmoji(this.myEmoji);
    },

    removeMyEmoji() {
      this.myEmoji = "";
    },

    async loadMoodEmojis(channel) {
      this.myEmoji    = "";
      this.otherEmoji = "";
    
      for await (const entry of this.$graffiti.discover(
        [ channel ],
        this.moodSchema
      )) {
        const obj = entry.object ?? entry;
        if (!obj?.value) continue;
    
        const { emoji } = obj.value;
        if (!emoji) continue;
    
        if (obj.actor === this.session.actor) {
          this.myEmoji = emoji;
        }
        else if (obj.actor === this.selectedUser.id) {
          this.otherEmoji = emoji;
        }
      }
    },
    
    async saveMyMoodEmoji(emoji) {
      await this.$graffiti.put({
        value: { emoji, timestamp: Date.now() },
        channels: [ this.selectedChannel ]
      }, this.session);
    },

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
      this.publicProfiles = Object.values(latestMap).map(o => {
        const webId = o.value.describes;
        const local = webId.split('/').filter(Boolean).pop();
        return {
          id: webId,
          name: o.value.name || local,
          iconUrl: o.value.icon || null,
          localId: local
        };
      });
    },

    // Send a friend request
    async addFriend(targetId) {
      const me = this.session.actor;
    
      const payload = {
        value: { activity: "friend", target: targetId },
        channels: [ me, targetId ]
      };
    
      await this.$graffiti.put(payload, this.session);
      await this.refreshFriends();
    },

    async _deleteSingle({ actor, target }) {
      for (const f of this.friendObjects) {
        if (f.actor === actor && f.value.target === target) {
          await this.$graffiti.delete(f, this.session);
          break;
        }
      }
    },

    async acceptRequest(theirId) {
      const me = this.session.actor;
      await this.$graffiti.put({
        value:    { activity: "friend", target: theirId },
        channels: [ me, theirId ]
      }, this.session);
      await this.refreshFriends();
    },
  
    async rejectRequest(theirId) {
      const me = this.session.actor;
      await this.$graffiti.put({
        value:    { activity: "friend_cancel", target: theirId },
        channels: [ me, theirId ]
      }, this.session);
      await this.refreshFriends();
    },
    
    // Remove mutual friendship
    async removeFriend(id) {
      await this._deleteSingle({ actor: this.session.actor, target: id });
      await this.$graffiti.put({
        value:    { activity: "friend_cancel", target: id },
        channels: [this.session.actor, id]
      }, this.session);
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
    async selectUser(user) {
      this.selectedUser = user;
      this.selectedChannel = [this.session.actor, user.id].sort().join("--");
      this.editingMessage = false;
      this.editingObject = null;
      this.myMessage = "";
      this.selectedFeature = null;
      await this.loadMoodEmojis(this.selectedChannel);
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
      this.saveProfile();
    },

    // Remove current picture
    removeProfilePic() {
      this.profilePicFile = null;
      this.profilePicUrl = "";
      this.profilePicPreview = "";

      if (this.profileObject?.value) {
        this.profileObject.value.icon = "";
        this.saveProfile();
      }
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
        channels: ["designftw-2025-studio2", this.session.actor]
      };

      // Put and store URL if new
      const res = await this.$graffiti.put(payload, this.session);
      this.profileObject = { ...payload, url: res.url || this.profileObject?.url };

      await this.refreshPublicProfiles();

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