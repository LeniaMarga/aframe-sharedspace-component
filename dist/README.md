# Component overview

When installing `sharedspace`, four components are registered with A-Frame:

| Component                             | Description                                          |
|---------------------------------------|------------------------------------------------------|
| [`sharedspace`](#sharedspace)         | Provides the participation model.                    |
| [`participants`](#participants)       | Represent participants as A-Frame entities.          |
| [`share`](#share)                     | Controls the state of the participant to share.      |
| [`position-around`](#position-around) | Helper to position an entity around a central point. |

## sharedspace

This component provides the participation model: a named room with participants entering and leaving. Participants can send arbitrary data to other participants or share audio with all of them. We refer to the participant representing the user as the _local participant_, while other people in the room are _remote participants_, _peers_ or simply, _participants_.

### Properties

| Property   | Description                                     | Default |
|------------|-------------------------------------------------|---------|
| `hold`     | If set, prevents the component from connecting. | `false` |
| `provider` | URL to the signaling server. | `https://salvadelapuente.com:9000` |
| `room`     | Room name. | [`room-101`](http://matrix.wikia.com/wiki/Room_101) |
| `audio`    | If set, will ask for user media.                | `false` |
| `me`       | User unique id. Randomly generated by default.  | `''`    |

Set the `hold` property to `true` to prevent the component from joining the room. While holding, configure the component and connect by setting `hold` to `false`. Notice that changing the properties once the `sharedspace` component has connected has no effect.

Use this technique to generate room links and share them with your friends, or to join specific rooms. Consider the following snippet as reference:

```html
<a-scene>
  <a-entity sharedspace="hold: true">
    <!-- Your room -->
  </a-entity>
<a-scene>

<script>
  var room = document.querySelector('[sharedspace]');
  var roomName = window.location.search.substr(1);
  if (!roomName) {
    roomName = Date.now() + '';
    history.pushState({}, '', window.location + '?' + roomName);
  }
  connect();

  function connect() {
    var scene = document.querySelector('a-scene');
    if (!scene.hasLoaded) {
      scene.addEventListener('loaded', connect);
      return;
    }
    room.setAttribute('sharedspace', { room: roomName, hold: false });
  }
</script>
```

### Methods

#### `isConnected()`

Returns `true` if the local participant has connected to the **signaling server**. It does not guarantee that the local participant can join the room.

You can consider the component effectively connected after receiving your `enterparticipant` event (i.e. that with the `isMe` property set to `true`).

```js
// <a-entity sharedspace></a-entity>
var room = document.querySelector('[sharedspace]');
room.components.sharedspace.isConnected();
```

#### `send(target, message)`

Send a [JSON-serializable](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify) `message` to the participant with `target` id. Use `*` as `target` to broadcast the message to all remote participants.

```js
// <a-entity sharedspace></a-entity>
var room = document.querySelector('[sharedspace]');
room.components.sharedspace.send('*', { myName: 'Salva' });
```

### Events

| Name                 | Description                                       |
|----------------------|---------------------------------------------------|
| `enterparticipant`   | The local or a remote participant joins the room. |
| `exitparticipant`    | A remote participant exits the room.              |
| `participantstream`  | A remote participant shares audio.                |
| `participantmessage` | A remote participant sends a message.             |

Events `participantstream` and `participantmessage` for a participant are guaranteed to be received after the `enterparticipant` event of the same participant. Otherwise is a [bug](https://github.com/delapuente/aframe-sharedspace-component/issues).

All the events are emitted in the component's element:

```js
// <a-entity sharedspace></a-entity>
var room = document.querySelector('[sharedspace]');
room.addEventListener('enterparticipant', function (evt) {
  var detail = evt.detail;
  console.log(detail.id + 'entered with position ' + detail.position);
});
```

#### Detail

<table>
  <thead>
    <tr>
      <th>Name</th>
      <th>Detail</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="3"><code>enterparticipant</code></td>
      <td><code>id</code></td>
      <td>Participant unique id.</td>
    </tr>
    <tr>
      <td><code>position</code></td>
      <td>Order in the room.</td>
    </tr>
    <tr>
      <td><code>isMe</code></td>
      <td><code>true</code> if it’s the local participant.</td>
    </tr>
    <tr>
      <td rowspan="3"><code>exitparticipant</code></td>
      <td><code>id</code></td>
      <td>Participant unique id.</td>
    </tr>
    <tr>
      <td><code>position</code></td>
      <td>Order in the room.</td>
    </tr>
    <tr>
      <td><code>isMe</code></td>
      <td><code>true</code> if it’s the local participant.</td>
    </tr>
    <tr>
      <td rowspan="2"><code>participantstream</code></td>
      <td><code>id</code></td>
      <td>Participant unique id.</td>
    </tr>
    <tr>
      <td><code>stream</code></td>
      <td><a href="https://developer.mozilla.org/en-US/docs/Web/API/MediaStream">MediaStream</a> object</td>
    </tr>
    <tr>
      <td rowspan="2"><code>participantmessage</code></td>
      <td><code>id</code></td>
      <td>Participant unique id.</td>
    </tr>
    <tr>
      <td><code>message</code></td>
      <td>Message</td>
    </tr>
  </tbody>
</table>

## participants

The `sharedspace` component is useless in isolation, but provides the necessary hooks for creating multi-user experiences. To use `sharedspace` in an effective way, your application should listen to the aforementioned events and translate them into changes in the A-Frame scene. The `participants` component does this in a configurable and powerful way.

The `participants` component use an HTML5 template to instantiate new participants. It gives them an id and position in the form of [`data-*`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/data-*) attributes and attaches participant audio streams as A-Frame positional audio. When instantiating the _local participant_, special customization is possible.

### Properties

| Property     | Description                                                         | Default           |
|--------------|---------------------------------------------------------------------|-------------------|
| `template`   | CSS selector of the participant `template` tag or `none`.           | `template`        |
| `placement`  | Component to position the participant instance or `none`.           | `position-around` |
| `onmyself`   | A-Frame mixin id or `auto` or `none`. It controls the configuration of the local participant instance.  | `auto` |
| `audio`      | If set, will convert media streams into positional audio.           | `true`            |
| `autoremove` | If set, removes the participant from the DOM if it exits.           | `true`            |

#### Disabling participant instantiation

Setting `template` to `none` will disable instantiation of new participants. It will be your reponsibility to create an avatar for your peers and yourself. To keep the interoperability with other features such as `audio` or `autoremove`, set the `data-sharedspace-id` attribute of the custom avatar to the `sharedspace` id of the participant:

```js
// <a-entity sharedspace="audio: true" participants="template: none"></a-entity>
var room = document.querySelector('[sharedspace]');
room.addEventListener('enterparticipant', function (evt) {
  var avatar = getCustomAvatar();
  avatar.dataset.sharedspaceId = evt.detail.id;
  room.appendChild(avatar);
);
```

#### Customizing the local participant

By default, `onmyself` is set to `auto` which means adding the following components, when instantiating the template for the local participant:

 * `camera` for the avatar to become the active camera.
 * `look-controls` to rotate the avatar by dragging on the screen.
 * `share="rotation"` to keep own rotation synchronized with the other peers.
  
If you prefer to provide your own components and to control which of them are shared, set `onmyself` to the id of an [A-Frame mixin](https://aframe.io/docs/0.7.0/core/mixins.html). The following configuration adds `wasd-controls` to move the avatar around with the `w`, `a`, `s` and `d` keys and shares position for the peers to see how the local participant moves:

```html
<a-scene>
  <a-assets>
    <a-mixin id="me" look-controls wasd-controls share="position, rotation"></a-mixin>
  </a-assets>
  <a-entity sharedspace="audio: true" participants="onmyself: me">
  </a-entity>
</a-scene>
<template>
  <!-- Participant avatar -->
</template>
```

> **NOTE**: Due to a bug in A-Frame, it is impossible to set a `camera` component in a mixin. Since the camera in the local participant is a vey common case, it is always added. Use the `participantsetup` event to customize the participant element and remove the `camera` component if you don't want it.

[Try it yourself by remixing the Minimal Chatroom](https://glitch.com/edit/#!/minimal-chatroom) project on Glitch.

#### Placing the participants

It is important for the participants in multi-user experiences to not overlap with each other and keep some free space around. The `placement` property accepts the name of an arbitrary component or `none`. If set to `none`, placement is disabled. But if set to a registered component, instantiation process will set the `position` property of the component to the participant's position in the room.

The [`position-around`](#position-around) component, included with `sharedspace` will arrange the participants around a particular point but other arrangements are possible. Room positions starts in 1. The following code will [register a component](https://aframe.io/docs/0.7.0/core/component.html#register-a-component) that arranges entities in a queue extending to -Z axis.

```html
<script>
  AFRAME.registerComponent('queue', {
    dependencies: ['position'],

    schema: {
      position: { default: 1 },
      separation: { default: 2 }
    },

    update() {
      var position = this.el.getAttribute('position');
      position.z = - (this.data.position - 1) * this.data.separation;
      this.el.setAttribute('position', position);
    }
  });
</script>
<a-scene>
  <a-entity sharedspace="audio: true" participants="placement: queue">
  </a-entity>
</a-scene>
<template>
  <!-- Participant avatar -->
</template>
```

Notice that `placement` does not deal with orientation. By default, cameras are created looking to -Z axis. You will need to customize the participant element to modify the initial orientation. Read more about how to customize the participant elements in the next section.

### Events

| Name                 | Description                                                                         |
|----------------------|-------------------------------------------------------------------------------------|
| `participantelement` | There is going to be some operation with the participant element.                   |
| `participantsetup`   | The participant element is configured, including local participant customizations . |
| `participantadded`   | The participant element has been added to the room.                                 |

Events `participantsetup` and `participantadded` only happen while adding a new participant. The `participantelement` event can happen while adding or removing.

The following snippet will make the participant element set the orieantation once the new participant is added:

```js
// <a-entity sharedspace></a-entity>
room.addEventListener('participantadded', function onParticipant(evt) {
  var participant = evt.detail.participant;
  if (!participant.hasLoaded) {
    participant.addEventListener('loaded', onParticipant.bind(null, evt));
    return;
  }
  
  var center = { x: 0, z: 0 };
  var participantY = participant.getAttribute('position').y;
  participant.object3D.lookAt(new THREE.Vector3(
    center.x, participantY, center.z
  ));

  var radToDeg = THREE.Math.radToDeg;
  var rotation = participant.object3D.rotation;
  rotation.y += Math.PI;
  participant.setAttribute('rotation', {
    x: radToDeg(rotation.x),
    y: radToDeg(rotation.y),
    z: radToDeg(rotation.z)
  });
});
```

#### Detail

<table>
  <thead>
    <tr>
      <th>Name</th>
      <th>Detail</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="3"><code>participantelement</code></td>
      <td><code>participant</code></td>
      <td>Participant HTML element.</td>
    </tr>
    <tr>
      <td><code>action</code></td>
      <td><code>'enter'</code> during the creation or <code>'exit'</code> during the removal.</td>
    </tr>
    <tr>
      <td><code>isMe</code></td>
      <td><code>true</code> if it’s the local participant.</td>
    </tr>
    <tr>
      <td rowspan="2"><code>participantsetup</code></td>
      <td><code>participant</code></td>
      <td>Participant HTML element.</td>
    </tr>
    <tr>
      <td><code>isMe</code></td>
      <td><code>true</code> if it’s the local participant.</td>
    </tr>
    <tr>
      <td rowspan="2"><code>participantadded</code></td>
      <td><code>participant</code></td>
      <td>Participant HTML element.</td>
    </tr>
        <tr>
      <td><code>isMe</code></td>
      <td><code>true</code> if it’s the local participant.</td>
    </tr>
  </tbody>
</table>

## share

The `share` component is a companion of the `particpants` component. It controls what components of the local participant element will be shared among all the participants. The `share` component can be included in the [A-Frame mixin](https://aframe.io/docs/0.7.0/core/mixins.html) used for [customizing the local participant](#customizing-the-loca-participant) or during the `participantelement` event (in a synchronous way). It defaults in the empty list which means all the components will be shared. Be careful since "all the components" includes the `camera` component.

### Sharing nested elements' state

The `share` component will share other components of the element where the component is applied. Only. Sharing components in nested elements is impossible but a workaround exists: register custom components in charge of collecting and propagating internal updates.

For instance, the following code will change the color of some nested element:

```html
<script>
  AFRAME.registerComponent('theme', {
    schema: { type: 'color', default: 'black' },

    update() {
      var color = this.data;
      var themable = this.el.querySelectorAll('.themable');
      themable.forEach(function (el) {
        el.setAttribute('color', color);
      });
    }
  });
</script>
<a-scene>
  <a-assets>
    <a-mixin id="me" look-controls share="rotation, theme"></a-mixin>
  </a-assets>
  <a-entity sharedspace="audio: true" participants="placement: queue">
  </a-entity>
</a-scene>
<template>
  <a-entity theme position-around>
    <!-- Party hat -->
    <a-cone class="themable"
            position="0 0.23 0"
            radius-bottom="0.075" radius-top="0" height="0.15"
            segments-height="1" segments-radial="8">
    </a-cone>

    <!-- Face -->
    <a-cylinder rotation="90 0 0"
                radius="0.15" height="0.075"
                segments-height="1" segments-radial="5">
    </a-cylinder>

    <!-- Cool glasses -->
    <a-plane class="themable"
             position="0 0.038 -0.040" rotation="180 0 0"
             depth="0.015" width="0.27" height="0.06" color="#000">
    </a-plane>
  </a-entity>
</template>
```

## position-around

This component modifies the `position` component of an A-Frame entity to make it appear in a virtual circle. The position 1 is at the right of the circle; the position 2 is in front of 1. The position 3 is on the top of the circle; the position 4 is in front of 3. The position 5 is in the middle of 1 and 3; the position 6 is in front of 5 and so on...

![Entities are positioned according to circle around a center with and offset height. Positions tend to occupy the farthest space to previous positions.](https://cdn.rawgit.com/delapuente/aframe-sharedspace-component/master/img/position-around.svg)


### Properties

| Property   | Description                                      | Default   |
|------------|--------------------------------------------------|-----------|
| `center`   | Point around which, the entities will be placed. | `0, 0, 0` |
| `radius`   | Entity's distance to the center.                 | 1.1       |
| `height`   | Displacement in +Y above the final position.     | 1.6       |
| `position` | Position aroung the central point.               | 1         |
