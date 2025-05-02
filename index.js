import { createApp } from "vue";
import { GraffitiLocal } from "@graffiti-garden/implementation-local";
import { GraffitiRemote } from "@graffiti-garden/implementation-remote";
import { GraffitiPlugin } from "@graffiti-garden/wrapper-vue";
import { fileToGraffitiObject } from "@graffiti-garden/wrapper-files";

const ListSection = {
  props: {
    title: String,
    items: Array,
    showRemove:{ type: Boolean, default: false }
  },
  emits: ["select","remove"],
  template: `
    <div class="list-section">
      <h2>{{ title }}</h2>
      <ul>
        <li v-for="item in items" :key="item.id">
          <img
            class="list-avatar"
            :src="item.iconUrl || 'images/profile.png'"
            alt=""
          />
          <span class="list-label" @click="$emit('select', item)">
            {{ item.name }}
          </span>
          <button
            v-if="showRemove"
            class="btn-remove"
            @click="$emit('remove', item.id)"
          >Remove</button>
        </li>
      </ul>
    </div>
  `
};

createApp({
  components: {
    ListSection
  },
  
  data() {
    return {
      session: null,

      // MESSAGES
      currentTab: "messages",
      users: [ ],
      selectedUser: null,
      selectedChannel: null,
      myMessage: "",
      editingMessage: false,
      editingObject: null,
      messageSchema: {
        properties: {
          value: {
            required: ["content","published"],
            properties: {
              content:   { type: "string" },
              published: { type: "number" }
            }
          }
        }
      },

      // FRIENDS
      friendOptions: [
        { key: "list",     label: "Friends List",    icon: "images/friendslist.png"    },
        { key: "requests", label: "Friend Requests", icon: "images/friendrequests.png" }
      ],
      friendTab: "list",
      friendActor: "",
      friendSchema: {
        properties: {
          value: {
            required: ["activity","target"],
            properties: {
              activity: { const: "friend" },
              target:   { type: "string" }
            }
          }
        }
      },
      friendObjects: [],

      // PROFILE
      profileName: "",
      profilePronouns: "",
      profileBio: "",
      profilePicFile: null,
      profilePicPreview: "",
      profilePicUrl: "",
      profileSchema: {
        properties: {
          value: {
            required: ["describes","published"],
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

  async mounted() {
    const s = await this.$graffiti.login();   
    this.session = s;
    
    //debug
    if (!s || !s.actor) {
      console.warn("Login failed or returned invalid session");
      return;
    }

    const allProfiles = [];
    for await (const o of this.$graffiti.discover({
      channels: [s.actor],
      schema: this.profileSchema
    })) {
      allProfiles.push(o);
    }
    if (allProfiles.length) {
      const latest = allProfiles.sort((a,b)=>b.value.published - a.value.published)[0].value;
      this.profileName     = latest.name;
      this.profilePronouns = latest.pronouns;
      this.profileBio      = latest.bio;
      this.profilePicUrl   = latest.icon || "";
      this.profilePicPreview = this.profilePicUrl;
    }

    const fobs = [];
    for await (const o of this.$graffiti.discover({
      channels: [s.actor],
      schema: this.friendSchema
    })) {
      fobs.push(o);
    }
    this.friendObjects = fobs;
  },

  computed: {
    acceptedFriends() {
      if (!this.session) return [];
      
      const mine = new Set(this.friendObjects.filter(f => f.actor === this.session.actor).map(f => f.value.target));
      const theirs = new Set(this.friendObjects.filter(f => f.value.target === this.session.actor).map(f => f.actor));
      
      return [...mine].filter(x => theirs.has(x)).map(id => ({
        id: id,
        name: id,
        iconUrl: null
      }));
    },
    
    friendRequests() {
      if (!this.session) return [];
      
      const mine = new Set(this.friendObjects.filter(f => f.actor === this.session.actor).map(f => f.value.target));
      const theirs = new Set(this.friendObjects.filter(f => f.value.target === this.session.actor).map(f => f.actor));
      
      return [...theirs].filter(x => !mine.has(x)).map(id => ({
        id: id,
        name: id,
        iconUrl: null
      }));
    },
    
    sentRequests() {
      if (!this.session) return [];
      
      const mine = new Set(this.friendObjects.filter(f => f.actor === this.session.actor).map(f => f.value.target));
      const theirs = new Set(this.friendObjects.filter(f => f.value.target === this.session.actor).map(f => f.actor));
      
      return [...mine].filter(x => !theirs.has(x)).map(id => ({
        id: id,
        name: id,
        iconUrl: null
      }));
    }
  },

  methods: {
    selectUser(user) {
      this.selectedUser = user;
      this.selectedChannel = [this.session.actor, user.id].sort().join("--");
      this.editingMessage = false;
      this.editingObject = null;
      this.myMessage = "";
    },
    
    async sendMessage() {
      if (!this.myMessage.trim()) return;
      await this.$graffiti.put(
        { value:{content:this.myMessage,published:Date.now()}, channels:[this.selectedChannel] },
        this.session
      );
      this.myMessage = "";
    },

    // FRIENDS
    async addFriend(target) {
      if (!this.session) {
        console.error("Cannot add friend: No active session");
        alert("Issues with add; not correctly implemented yet");
        return;
      }
    
      let targetId = target;
      
      if (typeof target === 'object' && target !== null) {
        targetId = target.id;
      }
      
      if (!targetId) return;
      
      try {
        await this.$graffiti.put(
          { 
            value: {
              activity: "friend",
              target: targetId
            }, 
            channels: [this.session.actor, targetId] 
          },
          this.session
        );
        
        await this.mounted();
      } catch (error) {
        console.error("Error adding friend:", error);
        alert("Failed to add friend. Please try again.");
      }
    },
    
    async removeFriend(id) { 
      await this._deletePair(id); 
      await this.mounted(); 
    },
    
    async declineRequest(id) { 
      await this._deleteSingle({ actor:id, target:this.session.actor }); 
      await this.mounted(); 
    },
    
    async cancelRequest(id) { 
      await this._deleteSingle({ actor:this.session.actor, target:id }); 
      await this.mounted(); 
    },

    async _deleteSingle(criteria) {
      const o = this.friendObjects.find(f=>f.actor===criteria.actor && f.value.target===criteria.target);
      if (o) await this.$graffiti.delete(o, this.session);
    },
    
    async _deletePair(id) {
      await this._deleteSingle({ actor:this.session.actor, target:id });
      await this._deleteSingle({ actor:id, target:this.session.actor });
    },

    // PROFILE
    onProfilePicChange(e) {
      const file = e.target.files[0];
      if (!file) return;
      this.profilePicFile    = file;
      this.profilePicPreview = URL.createObjectURL(file);
    },
    
    removeProfilePic() {
      this.profilePicFile    = null;
      this.profilePicUrl     = "";
      this.profilePicPreview = "";
    },
    
    async saveProfile() {
      if (this.profilePicFile) {
        const obj = await fileToGraffitiObject(this.profilePicFile);
        const { url } = await this.$graffiti.put(obj, this.session);
        this.profilePicUrl    = url;
        this.profilePicFile   = null;
      }
      await this.$graffiti.put(
        {
          value:{
            describes: this.session.actor,
            name:      this.profileName,
            pronouns:  this.profilePronouns,
            bio:       this.profileBio,
            icon:      this.profilePicUrl,
            published: Date.now()
          },
          channels: [ this.session.actor ]
        },
        this.session
      );
      alert("Profile saved!");
    },

    logout() {
      if (this.session) {
        this.$graffiti.logout(this.session);
        this.session = null;
        window.location.reload();
      } else {
        console.warn("No active session to logout");
        window.location.reload();
      }
    },

    startEdit(msg) {
      this.editingMessage = true;
      this.editingObject = msg;
      this.myMessage = msg.value.content;
      this.$nextTick(() => this.$refs.messageInput.focus());
    },
    
    cancelEdit() {
      this.editingMessage = false;
      this.editingObject = null;
      this.myMessage = "";
    },
    
    async updateMessage() {
      if (!this.myMessage.trim() || !this.editingObject) return;
      const updatedObject = {
        ...this.editingObject,
        value: {
          ...this.editingObject.value,
          content: this.myMessage.trim(),
          edited: true,
          editedAt: Date.now()
        }
      };
      
      await this.$graffiti.put(updatedObject, this.session);
      
      this.editingMessage = false;
      this.editingObject = null;
      this.myMessage = "";
    },
    
    async deleteMessage(msg) {
      if (confirm("Are you sure you want to delete this message?")) {
        await this.$graffiti.delete(msg, this.session);
        
        if (this.editingObject && this.editingObject.url === msg.url) {
          this.cancelEdit();
        }
      }
    }
  }
})
.use(GraffitiPlugin, {
  graffiti: new GraffitiLocal(),
  // graffiti: new GraffitiRemote(),
})
.mount("#app");