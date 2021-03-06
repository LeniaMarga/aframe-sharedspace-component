import { registerComponent, utils } from 'aframe';
import { SceneTree } from './scene-tree';
import { EntityObserver } from './entity-observer';

const bind = utils.bind;
const log = utils.debug('sharedspace:avatars:log');
const warn = utils.debug('sharedspace:avatars:warn');

export default registerComponent('avatars', {

  dependencies: ['sharedspace'],

  schema: {
    // Should it be a custom type to parse none as null?
    template: { type: 'selector', default: 'template' },
    placement: { type: 'string', default: 'position-around' },
    onmyself: { type: 'string', default: 'auto' },
    audio: { default: true },
    autoremove: { default: true }
  },

  init () {
    this._tree = new SceneTree(this.el);
    this._ongoingUpdates = [];
    this._incomingUpdates = [];
    this._collectToSend = bind(this._collectToSend, this);
    this._observer = new EntityObserver(this._collectToSend);
    this._sharedspace = this.el.components.sharedspace;

    this._onEnter = bind(this._onEnter, this);
    this._onStream = bind(this._onStream, this);
    this._onMessage = bind(this._onMessage, this);
    this._onExit = bind(this._onExit, this);

    this.el.addEventListener('enterparticipant', this._onEnter);
    this.el.addEventListener('participantstream', this._onStream);
    this.el.addEventListener('participantmessage', this._onMessage);
    this.el.addEventListener('exitparticipant', this._onExit);
  },

  remove () {
    this.el.removeEventListener('enterparticipant', this._onEnter);
    this.el.removeEventListener('participantstream', this._onStream);
    this.el.removeEventListener('participantmessage', this._onMessage);
    this.el.removeEventListener('exitparticipant', this._onExit);
  },

  tick (...args) {
    this._observer.check(...args);
    if (this._sharedspace.isConnected()) {
      this._sendUpdates();
      this._applyUpdates();
    }
  },

  _onEnter ({ detail: { id, position } }) {
    if (this.data.template && !this._getAvatar(id)) {
      this._addAvatar(id, position);
    }
  },

  _onStream ({ detail: { id, stream } }) {
    if (!this.data.audio) { return; }

    const avatar = this._getAvatar(id);
    if (!avatar) {
      warn(`Avatar ${id} avatar is not in the DOM`);
      return;
    }

    this._addStream(id, stream)
    .then(source => {
      log(`streaming: ${id}`, stream);
      avatar.setAttribute('sound', `src: #${source.id}`);
    });
  },

  _onExit ({ detail: { id } }) {
    const isMe = id === this._sharedspace.data.me;
    const avatar = this._getAvatar(id);
    if (avatar) {
      this.el.emit('avatarelement', { avatar, isMe, action: 'exit' });
      if (this.data.autoremove) {
        avatar.parentNode.removeChild(avatar);
      }
    }
  },

  _onMessage ({ detail: { id, message } }) {
    if (message.type === 'avatarsupdates') {
      this._collectToApply(message.updates);
    }
  },

  _getAvatar (id) {
    return this.el.querySelector(`[data-sharedspace-id="${id}"]`);
  },

  _addAvatar (id, position) {
    const isMe = id === this._sharedspace.data.me;
    const avatar = this._newAvatar();
    this.el.emit('avatarelement', { avatar, isMe, action: 'enter' });

    this._setupAvatar(avatar, id, position);
    if (isMe) {
      this._setupLocalAvatar(avatar);
    }
    this.el.emit('avatarsetup', { avatar, isMe });

    this.el.appendChild(avatar);
    this.el.emit('avataradded', { avatar, isMe });

    return avatar;
  },

  _newAvatar () {
    const empty = document.createElement('A-ENTITY');

    const template = this.data.template;
    if (!template) {
      warn('Template not found. Using an empty entity.');
      return empty;
    }

    const instance = document.importNode(template.content, true).children[0];
    if (!instance) {
      warn('Template was empty. Using an empty entity.');
      return empty;
    }

    return instance;
  },

  _setupAvatar (avatar, id, position) {
    const isMe = id === this._sharedspace.data.me;
    avatar.dataset.sharedspaceId = id;
    avatar.dataset.sharedspaceRoomPosition = position;
    avatar.dataset.isMe = isMe;

    const placement = this.data.placement;
    if (placement !== 'none') {
      avatar.addEventListener('loaded', function onLoaded () {
        avatar.removeEventListener('loaded', onLoaded);
        avatar.setAttribute(placement, { position });
      });
    }

    return avatar;
  },

  _setupLocalAvatar (avatar) {
    if (this.data.onmyself === 'auto') {
      avatar.setAttribute('camera', '');
      avatar.setAttribute('look-controls', '');
      avatar.setAttribute('visible', 'false');
      avatar.setAttribute('share', 'rotation');
    } else if (this.data.onmyself !== 'none') {
      // HACK: Remove this when camera can be used inside a mixin.
      // If you want to remove the camera right now, use avatarsetup event
      // and remove it from detail.avatar element.
      avatar.setAttribute('camera', '');
      const mixinList = avatar.hasAttribute('mixin')
                        ? avatar.getAttribute('mixin').split(/\s+/) : [];

      mixinList.push(this.data.onmyself);
      avatar.setAttribute('mixin', mixinList.join(' '));
    }

    avatar.addEventListener('componentinitialized', ({ detail }) => {
      const { name } = detail;
      if (name === 'share') {
        const share = avatar.components.share;
        const filter = share.data.split(',').map(str => str.trim());
        log('sharing:', filter);
        this._share(avatar, filter.length > 0 ? filter : null);
      }
    });
  },

  _share (el, componentFilter) {
    this._observer.observe(el, { components: true, componentFilter });
  },

  _addStream (id, stream) {
    return this._getAssets()
    .then(assets => {
      const source = new window.Audio();
      source.id = `avatar-stream-${id}`;
      source.srcObject = stream;
      assets.appendChild(source);
      return source;
    });
  },

  _getAssets () {
    let assets = this.el.sceneEl.querySelector('a-assets');
    if (!assets || !assets.hasLoaded) {
      assets = document.createElement('A-ASSETS');
      this.el.sceneEl.appendChild(assets);
      return new Promise(resolve => {
        assets.addEventListener('loaded', () => resolve(assets));
      });
    }
    return Promise.resolve(assets);
  },

  _collectToApply (updates) {
    this._incomingUpdates.push(...updates);
  },

  _collectToSend (updates) {
    updates = updates.map(update => {
      const serializable = Object.assign({}, update);
      const { sharedspaceId } = update.target.dataset;
      serializable.target = `[data-sharedspace-id="${sharedspaceId}"]`;
      return serializable;
    });
    this._ongoingUpdates.push(...updates);
  },

  _sendUpdates () {
    if (this._ongoingUpdates.length > 0) {
      const content = avatarsUpdatesMessage(this._ongoingUpdates);
      this._sharedspace.send('*', content);
      this._ongoingUpdates = [];
    }
  },

  _applyUpdates () {
    this._tree.applyUpdates(this._incomingUpdates);
    this._incomingUpdates = [];
  }
});

function avatarsUpdatesMessage (updates) {
  return { type: 'avatarsupdates', updates };
}
