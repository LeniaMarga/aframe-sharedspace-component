const EventTarget = require('event-target-shim');
const GuestList = require(
  '../../../../src/components/sharedspace/participation/guest-list'
).GuestList;

suite('Participation', () => {
  /* eslint-disable import/no-webpack-loader-syntax */
  const inject = require(
    'inject-loader!../../../../src/components/sharedspace/participation'
  );
  /* eslint-enable import/no-webpack-loader-syntax */

  let Participation;
  let participation;

  let GuestListSpy;
  let fakeRTCInterfaceCons, fakeRTCInterface;

  const nowFunction = Date.now;
  const now = 2;
  const stream = new window.MediaStream();

  setup(() => {
    Date.now = () => now;

    GuestListSpy = sinon.spy(GuestList);
    GuestListSpy.copy = GuestList.copy;
    GuestListSpy.serialize = GuestList.serialize;
    GuestListSpy.deserialize = GuestList.deserialize;
    GuestListSpy.transformationCost = GuestList.transformationCost;

    fakeRTCInterfaceCons = class extends EventTarget {
      constructor (room, { id }) {
        super();
        this._connections = {};
        this._id = id;
        fakeRTCInterface = this;
      }

      connect () {
        this._connected = true;
        return Promise.resolve();
      }

      isConnected (id) {
        return this._connections[id];
      }

      get me () {
        return this._connected && (this._id || 'randomId');
      }

      fakeConnection (id) {
        this._connections[id] = true;
        this.emit('connect', { id });
      }

      fakeDisconnection (id) {
        this._connections[id] = false;
        this.emit('close', { id });
      }

      emit (type, detail) {
        const event = new window.CustomEvent(type, { detail });
        fakeRTCInterface.dispatchEvent(event);
      }

      broadcast () {}

      send () {}
    };
    sinon.spy(fakeRTCInterfaceCons.prototype, 'connect');
    sinon.spy(fakeRTCInterfaceCons.prototype, 'broadcast');
    sinon.spy(fakeRTCInterfaceCons.prototype, 'send');
    fakeRTCInterfaceCons = sinon.spy(fakeRTCInterfaceCons);

    Participation = inject({
      './guest-list': { GuestList: GuestListSpy },
      '../rtc-interface': { RTCInterface: fakeRTCInterfaceCons }
    }).Participation;

    participation =
      new Participation('testRoom', { stream, provider: 'test.com' });
  });

  teardown(() => {
    Date.now = nowFunction;
  });

  suite('constructor', () => {
    test('constructs a RTCInterface object without connecting', () => {
      assert.isTrue(fakeRTCInterfaceCons.calledWith('testRoom', {
        id: undefined,
        stream,
        signaling: 'test.com'
      }));
      assert.isTrue(fakeRTCInterface.connect.notCalled);
    });
  });

  suite('me property', () => {
    test('returns unknown before connecting', () => {
      assert.isUndefined(participation.me);
    });

    test('after connecting, returns the id passed in the constructor', () => {
      participation = new Participation('testRoom', {
        id: 'myId',
        stream,
        provider: 'test.com'
      });
      return participation.connect()
      .then(() => {
        assert.equal(participation.me, 'myId');
      });
    });

    test('after connecting, returns an autogenerated id if not passed in the constructor', () => {
      return participation.connect()
      .then(() => {
        assert.equal(participation.me, 'randomId');
      });
    });
  });

  suite('connect method', () => {
    test('instantiates a guest list with the local user as participant', () => {
      return participation.connect()
      .then(() => {
        assert.isTrue(GuestListSpy.calledOnce);
        assert.isTrue(GuestListSpy.calledWith(now, ['randomId']));
      });
    });

    test('emits connect event', done => {
      participation.addEventListener('connected', ({ detail }) => {
        assert.equal(detail.me, 'randomId');
        done();
      });
      participation.connect();
    });
  });

  suite('after connect', () => {
    setup(() => {
      return participation.connect();
    });

    suite('send method', () => {
      const message = {};

      test('broadcasts message when passing * as target', () => {
        participation.send('*', message);
        assert.isTrue(fakeRTCInterface.broadcast.calledOnce);
        assert.isTrue(fakeRTCInterface.broadcast.calledWith({
          type: 'content',
          content: message
        }));
      });

      test('sends a message when passing an id as target', () => {
        participation.send('id1', message);
        assert.isTrue(fakeRTCInterface.send.calledOnce);
        assert.isTrue(fakeRTCInterface.send.calledWith('id1', {
          type: 'content',
          content: message
        }));
      });
    });

    function becomeHost () {
      let fulfil;

      participation.addEventListener('upgrade', function onUpgrade ({ detail }) {
        participation.removeEventListener('upgrade', onUpgrade);
        assert.equal(detail.role, 'host');
        fulfil();
      });

      return new Promise(resolve => {
        fulfil = resolve;
        fakeRTCInterface.fakeConnection('remoteId');
        fakeRTCInterface.emit('message', {
          from: 'remoteId',
          type: 'list',
          timestamp: now + 1,
          list: ['remoteId', 'randomId']
        });
      });
    }

    function becomeGuest () {
      let fulfil;

      participation.addEventListener('upgrade', function onUpgrade ({ detail }) {
        participation.removeEventListener('upgrade', onUpgrade);
        assert.equal(detail.role, 'guest');
        fulfil();
      });

      return new Promise(resolve => {
        fulfil = resolve;
        fakeRTCInterface.fakeConnection('remoteId');
        fakeRTCInterface.emit('message', {
          from: 'remoteId',
          type: 'list',
          timestamp: now - 1,
          list: ['remoteId', 'randomId']
        });
      });
    }

    function becomeDelayedGuest () {
      let fulfil;

      participation.addEventListener('upgrade', function onUpgrade ({ detail }) {
        participation.removeEventListener('upgrade', onUpgrade);
        assert.equal(detail.role, 'guest');
        fulfil();
      });

      return new Promise(resolve => {
        fulfil = resolve;
        fakeRTCInterface.fakeConnection('remoteId');
        fakeRTCInterface.emit('message', {
          from: 'remoteId',
          type: 'list',
          timestamp: now - 1,
          list: ['remoteId', 'remoteId2', 'randomId']
        });
      });
    }

    suite('if role is unknown', () => {
      suite('on RTC connect', () => {
        test('updates and broadcast list', () => {
          participation.addEventListener('enterparticipant', () => {
            assert.isTrue(false, 'Should not advertise changes.');
          });
          fakeRTCInterface.fakeConnection('remoteId');
          assert.isTrue(fakeRTCInterface.broadcast.calledOnce);
          assert.isTrue(fakeRTCInterface.broadcast.calledWith({
            type: 'list',
            timestamp: now,
            list: ['randomId', 'remoteId']
          }));
        });
      });

      suite('on RTC stream', () => {
        setup(() => {
          fakeRTCInterface.emit('stream', { id: 'remoteId2', stream });
        });

        test('holds the event until confirming presence after becoming host', done => {
          participation.addEventListener('participantstream', ({ detail }) => {
            assert.equal(detail.id, 'remoteId2');
            assert.equal(detail.stream, stream);
            done();
          });
          fakeRTCInterface.fakeConnection('remoteId2');
          becomeHost();
        });

        test('holds the event until confirming presence after becoming guest', done => {
          participation.addEventListener('participantstream', ({ detail }) => {
            assert.equal(detail.id, 'remoteId2');
            assert.equal(detail.stream, stream);
            done();
          });
          fakeRTCInterface.fakeConnection('remoteId2');
          becomeGuest();

          // Need to receive both connection and the updated list to finish
          // confirming presence of remoteId2.
          fakeRTCInterface.emit('message', {
            from: 'remoteId',
            type: 'list',
            timestamp: now - 1,
            list: ['remoteId', 'randomId', 'remoteId2']
          });
        });
      });

      suite('on RTC message', () => {
        test('becomes host after reciving a more recent guest list', () => {
          becomeHost();
        });

        test('becomes guest after reciving an older guest list', () => {
          becomeGuest();
        });

        suite('content messages', () => {
          setup(() => {
            fakeRTCInterface.emit('message', {
              from: 'remoteId',
              type: 'content',
              content: 'test'
            });
          });

          test('holds the event until confirming presence after becoming host', done => {
            participation.addEventListener('participantmessage', ({ detail }) => {
              assert.equal(detail.id, 'remoteId');
              assert.equal(detail.message, 'test');
              done();
            });
            fakeRTCInterface.fakeConnection('remoteId');
            becomeHost();
          });

          test('holds the event until confirming presence after becoming guest', done => {
            participation.addEventListener('participantmessage', ({ detail }) => {
              assert.equal(detail.id, 'remoteId');
              assert.equal(detail.message, 'test');
              done();
            });
            fakeRTCInterface.fakeConnection('remoteId');
            becomeGuest();
          });
        });
      });

      suite('on RTC close', () => {
        test('updates and broadcast list', () => {
          participation.addEventListener('exitparticipant', () => {
            assert.isTrue(false, 'Should not advertise changes.');
          });
          fakeRTCInterface.emit('close', { id: 'remoteId' });
          assert.isTrue(fakeRTCInterface.broadcast.calledOnce);
          assert.isTrue(fakeRTCInterface.broadcast.calledWith({
            type: 'list',
            timestamp: now,
            list: ['randomId']
          }));
        });
      });
    });

    suite('if role is guest', () => {
      setup(() => {
        return becomeGuest()
        .then(() => {
          fakeRTCInterface.broadcast.reset();
        });
      });

      suite('on RTC connect', () => {
        test('ignores connection', () => {
          participation.addEventListener('enterparticipant', () => {
            assert.isTrue(false, 'Should not advertise changes.');
          });
          fakeRTCInterface.fakeConnection('remoteId2');
          assert.isTrue(fakeRTCInterface.broadcast.notCalled);
        });
      });

      suite('on RTC stream', () => {
        setup(() => {
          fakeRTCInterface.emit('stream', { id: 'remoteId2', stream });
        });

        test('holds the event until confirming presence', done => {
          participation.addEventListener('participantstream', ({ detail }) => {
            assert.equal(detail.id, 'remoteId2');
            assert.equal(detail.stream, stream);
            done();
          });

          // Need to receive both connection and the updated list to finish
          // confirming presence of remoteId2.
          fakeRTCInterface.fakeConnection('remoteId2');
          fakeRTCInterface.emit('message', {
            from: 'remoteId',
            type: 'list',
            timestamp: now - 1,
            list: ['remoteId', 'randomId', 'remoteId2']
          });
        });
      });

      suite('on RTC message', () => {
        suite('list messages', () => {
          test('ignores if the list comes from a peer other than host', () => {
            participation.addEventListener('enterparticipant', () => {
              assert.isTrue(false, 'Should not advertise changes');
            });
            fakeRTCInterface.emit('message', {
              from: 'remoteId2',
              type: 'list',
              timestamp: now - 1,
              list: ['remoteId', 'randomId', 'remoteId2']
            });
          });

          test('advertises a participant is entering after receiving the list update and the participant connection', done => {
            participation.addEventListener('enterparticipant', ({ detail }) => {
              assert.equal(detail.id, 'remoteId2');
              assert.equal(detail.position, '3');
              assert.equal(detail.role, 'guest');
              done();
            });
            fakeRTCInterface.emit('message', {
              from: 'remoteId',
              type: 'list',
              timestamp: now - 1,
              list: ['remoteId', 'randomId', 'remoteId2']
            });
            fakeRTCInterface.fakeConnection('remoteId2');
          });

          test('advertises a participant is entering after receiving the participant connection and the list update', done => {
            participation.addEventListener('enterparticipant', ({ detail }) => {
              assert.equal(detail.id, 'remoteId2');
              assert.equal(detail.position, '3');
              assert.equal(detail.role, 'guest');
              done();
            });
            fakeRTCInterface.fakeConnection('remoteId2');
            fakeRTCInterface.emit('message', {
              from: 'remoteId',
              type: 'list',
              timestamp: now - 1,
              list: ['remoteId', 'randomId', 'remoteId2']
            });
          });

          test('advertises a participant is leaving after receiving the list update (not waiting for the actual disconnection)', done => {
            participation.addEventListener('exitparticipant', ({ detail }) => {
              assert.equal(detail.id, 'remoteId2');
              assert.equal(detail.position, '3');
              assert.equal(detail.role, 'guest');
              done();
            });
            fakeRTCInterface.fakeConnection('remoteId2');
            fakeRTCInterface.emit('message', {
              from: 'remoteId',
              type: 'list',
              timestamp: now - 1,
              list: ['remoteId', 'randomId', 'remoteId2']
            });
            fakeRTCInterface.emit('message', {
              from: 'remoteId',
              type: 'list',
              timestamp: now - 1,
              list: ['remoteId', 'randomId', null]
            });
          });
        });

        suite('content messages', () => {
          setup(() => {
            fakeRTCInterface.emit('message', {
              from: 'remoteId',
              type: 'content',
              content: 'test'
            });
          });

          test('holds the event until confirming presence', done => {
            participation.addEventListener('participantmessage', ({ detail }) => {
              assert.equal(detail.id, 'remoteId');
              assert.equal(detail.message, 'test');
              done();
            });
            fakeRTCInterface.fakeConnection('remoteId');
          });
        });
      });

      suite('on RTC close', () => {
        setup(() => {
          fakeRTCInterface.fakeConnection('remoteId2');
          fakeRTCInterface.emit('message', {
            from: 'remoteId',
            type: 'list',
            timestamp: now - 1,
            list: ['remoteId', 'randomId', 'remoteId2']
          });
        });

        test('if a guest peer is leaving, do nothing', () => {
          participation.addEventListener('upgrade', () => {
            assert.isTrue(false, 'There should be no upgrade');
          });
          fakeRTCInterface.fakeDisconnection('removeId2');
        });

        test('if the host peer is leaving and local is next host, take over', done => {
          participation.addEventListener('upgrade', ({ detail }) => {
            assert.equal(detail.role, 'host');
            done();
          });
          fakeRTCInterface.fakeDisconnection('remoteId');
        });

        test('if the host peer is leaving and local is not the next host, do nothing', () => {
          participation =
            new Participation('testRoom', { stream, provider: 'test.com' });
          return participation.connect()
          .then(() => becomeDelayedGuest())
          .then(() => {
            participation.addEventListener('upgrade', () => {
              assert.isTrue(false, 'There should be no upgrade');
            });
            fakeRTCInterface.fakeDisconnection('removeId2');
          });
        });
      });
    });

    suite('if role is host', () => {
      let clock;

      setup(() => {
        clock = sinon.useFakeTimers();
        return becomeHost()
        .then(() => {
          fakeRTCInterface.broadcast.reset();
        });
      });

      teardown(() => {
        clock.restore();
      });

      suite('guest list heartbeat', () => {
        test('send the guest list every 3 seconds', () => {
          clock.tick(10000);
          console.log(fakeRTCInterface.broadcast.callCount);
          assert.isTrue(fakeRTCInterface.broadcast.calledThrice);
          for (let i = 0; i < 3; i++) {
            const call = fakeRTCInterface.broadcast.getCall(i);
            assert.deepEqual(call.args[0], {
              type: 'list',
              timestamp: now,
              list: ['randomId', 'remoteId']
            });
          }
        });
      });

      suite('on RTC connect', () => {
        test('advertises a participant is entering', done => {
          participation.addEventListener('enterparticipant', ({ detail }) => {
            assert.equal(detail.id, 'remoteId2');
            assert.equal(detail.position, '3');
            assert.equal(detail.role, 'guest');
            assert.isTrue(fakeRTCInterface.broadcast.calledWith({
              type: 'list',
              timestamp: now,
              list: ['randomId', 'remoteId', 'remoteId2']
            }));
            done();
          });
          fakeRTCInterface.fakeConnection('remoteId2');
        });
      });

      suite('on RTC stream', () => {
        setup(() => {
          fakeRTCInterface.emit('stream', { id: 'remoteId2', stream });
        });

        test('holds the event until confirming presence', done => {
          participation.addEventListener('participantstream', ({ detail }) => {
            assert.equal(detail.id, 'remoteId2');
            assert.equal(detail.stream, stream);
            done();
          });

          fakeRTCInterface.fakeConnection('remoteId2');
        });
      });

      suite('on RTC message', () => {
        suite('list messages', () => {
          test('ignores lists', () => {
            participation.addEventListener('enterparticipant', () => {
              assert.isTrue(false, 'Should not advertise changes');
            });
            fakeRTCInterface.emit('message', {
              from: 'remoteId',
              type: 'list',
              timestamp: now - 1,
              list: ['remoteId', 'randomId', 'remoteId2']
            });
          });
        });

        suite('content messages', () => {
          setup(() => {
            fakeRTCInterface.emit('message', {
              from: 'remoteId',
              type: 'content',
              content: 'test'
            });
          });

          test('holds the event until confirming presence', done => {
            participation.addEventListener('participantmessage', ({ detail }) => {
              assert.equal(detail.id, 'remoteId');
              assert.equal(detail.message, 'test');
              done();
            });
            fakeRTCInterface.fakeConnection('remoteId');
          });
        });
      });

      suite('on RTC close', () => {
        setup(() => {
          fakeRTCInterface.fakeConnection('remoteId2');
          fakeRTCInterface.emit('message', {
            from: 'remoteId',
            type: 'list',
            timestamp: now + 1,
            list: ['randomId', 'remoteId', 'remoteId2']
          });
        });

        test('advertises a participant is exiting and broadcast the list', () => {
          let exitparticipantDone = false;
          participation.addEventListener('exitparticipant', ({ detail }) => {
            assert.equal(detail.id, 'remoteId2');
            assert.equal(detail.position, '3');
            assert.equal(detail.role, 'guest');
            exitparticipantDone = true;
          });
          fakeRTCInterface.fakeDisconnection('remoteId2');
          assert.isTrue(exitparticipantDone);
          assert.isTrue(fakeRTCInterface.broadcast.calledWith({
            type: 'list',
            timestamp: now,
            list: ['randomId', 'remoteId', null]
          }));
        });
      });
    });
  });
});
