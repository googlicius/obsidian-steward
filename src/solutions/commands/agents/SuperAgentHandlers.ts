import * as handlers from './handlers';
import { ActivateToolHandler } from '../shared/ActivateToolHandler';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import type { SuperAgent } from './SuperAgent';

/**
 * Interface for classes that have a renderer property
 * This allows SuperAgentHandlers to access renderer when mixed into SuperAgent
 */
interface HasRenderer {
  renderer: ConversationRenderer;
}

export class SuperAgentHandlers {
  private _vaultCreate: handlers.VaultCreate;
  private _vaultMove: handlers.VaultMove;
  private _vaultCopy: handlers.VaultCopy;
  private _vaultDelete: handlers.VaultDelete;
  private _vaultList: handlers.VaultList;
  private _vaultRename: handlers.VaultRename;
  private _vaultUpdateFrontmatter: handlers.VaultUpdateFrontmatter;
  private _vaultGrep: handlers.VaultGrep;
  private _activateToolHandler: ActivateToolHandler;
  private _revertDelete: handlers.RevertDelete;
  private _revertMove: handlers.RevertMove;
  private _revertFrontmatter: handlers.RevertFrontmatter;
  private _revertRename: handlers.RevertRename;
  private _revertCreate: handlers.RevertCreate;
  private _readContent: handlers.ReadContent;
  private _editHandler: handlers.EditHandler;
  private _userConfirm: handlers.UserConfirm;
  private _help: handlers.Help;
  private _stop: handlers.Stop;
  private _thankYou: handlers.ThankYou;
  private _buildSearchIndex: handlers.BuildSearchIndex;
  private _search: handlers.Search;
  private _searchMore: handlers.SearchMore;
  private _speech: handlers.Speech;
  private _image: handlers.Image;

  public get vaultMove(): handlers.VaultMove {
    if (!this._vaultMove) {
      this._vaultMove = new handlers.VaultMove(this as unknown as SuperAgent);
    }

    return this._vaultMove;
  }

  public get vaultCopy(): handlers.VaultCopy {
    if (!this._vaultCopy) {
      this._vaultCopy = new handlers.VaultCopy(this as unknown as SuperAgent);
    }

    return this._vaultCopy;
  }

  public get vaultDelete(): handlers.VaultDelete {
    if (!this._vaultDelete) {
      this._vaultDelete = new handlers.VaultDelete(this as unknown as SuperAgent);
    }

    return this._vaultDelete;
  }

  public get vaultCreate(): handlers.VaultCreate {
    if (!this._vaultCreate) {
      this._vaultCreate = new handlers.VaultCreate(this as unknown as SuperAgent);
    }

    return this._vaultCreate;
  }

  public get vaultList(): handlers.VaultList {
    if (!this._vaultList) {
      this._vaultList = new handlers.VaultList(this as unknown as SuperAgent);
    }

    return this._vaultList;
  }

  public get vaultRename(): handlers.VaultRename {
    if (!this._vaultRename) {
      this._vaultRename = new handlers.VaultRename(this as unknown as SuperAgent);
    }

    return this._vaultRename;
  }

  public get vaultUpdateFrontmatter(): handlers.VaultUpdateFrontmatter {
    if (!this._vaultUpdateFrontmatter) {
      this._vaultUpdateFrontmatter = new handlers.VaultUpdateFrontmatter(
        this as unknown as SuperAgent
      );
    }

    return this._vaultUpdateFrontmatter;
  }

  public get vaultGrep(): handlers.VaultGrep {
    if (!this._vaultGrep) {
      this._vaultGrep = new handlers.VaultGrep(this as unknown as SuperAgent);
    }

    return this._vaultGrep;
  }

  public get activateToolHandler(): ActivateToolHandler {
    if (!this._activateToolHandler) {
      this._activateToolHandler = new ActivateToolHandler(
        (this as unknown as HasRenderer).renderer
      );
    }

    return this._activateToolHandler;
  }

  public get revertDelete(): handlers.RevertDelete {
    if (!this._revertDelete) {
      this._revertDelete = new handlers.RevertDelete(this as unknown as SuperAgent);
    }

    return this._revertDelete;
  }

  public get revertMove(): handlers.RevertMove {
    if (!this._revertMove) {
      this._revertMove = new handlers.RevertMove(this as unknown as SuperAgent);
    }

    return this._revertMove;
  }

  public get revertFrontmatter(): handlers.RevertFrontmatter {
    if (!this._revertFrontmatter) {
      this._revertFrontmatter = new handlers.RevertFrontmatter(this as unknown as SuperAgent);
    }

    return this._revertFrontmatter;
  }

  public get revertRename(): handlers.RevertRename {
    if (!this._revertRename) {
      this._revertRename = new handlers.RevertRename(this as unknown as SuperAgent);
    }

    return this._revertRename;
  }

  public get revertCreate(): handlers.RevertCreate {
    if (!this._revertCreate) {
      this._revertCreate = new handlers.RevertCreate(this as unknown as SuperAgent);
    }

    return this._revertCreate;
  }

  public get readContent(): handlers.ReadContent {
    if (!this._readContent) {
      this._readContent = new handlers.ReadContent(this as unknown as SuperAgent);
    }

    return this._readContent;
  }

  public get editHandler(): handlers.EditHandler {
    if (!this._editHandler) {
      this._editHandler = new handlers.EditHandler(this as unknown as SuperAgent);
    }

    return this._editHandler;
  }

  public get userConfirm(): handlers.UserConfirm {
    if (!this._userConfirm) {
      this._userConfirm = new handlers.UserConfirm(this as unknown as SuperAgent);
    }

    return this._userConfirm;
  }

  public get help(): handlers.Help {
    if (!this._help) {
      this._help = new handlers.Help(this as unknown as SuperAgent);
    }

    return this._help;
  }

  public get stop(): handlers.Stop {
    if (!this._stop) {
      this._stop = new handlers.Stop(this as unknown as SuperAgent);
    }

    return this._stop;
  }

  public get thankYou(): handlers.ThankYou {
    if (!this._thankYou) {
      this._thankYou = new handlers.ThankYou(this as unknown as SuperAgent);
    }

    return this._thankYou;
  }

  public get buildSearchIndex(): handlers.BuildSearchIndex {
    if (!this._buildSearchIndex) {
      this._buildSearchIndex = new handlers.BuildSearchIndex(this as unknown as SuperAgent);
    }

    return this._buildSearchIndex;
  }

  public get search(): handlers.Search {
    if (!this._search) {
      this._search = new handlers.Search(this as unknown as SuperAgent);
    }

    return this._search;
  }

  public get searchMore(): handlers.SearchMore {
    if (!this._searchMore) {
      this._searchMore = new handlers.SearchMore(this as unknown as SuperAgent);
    }

    return this._searchMore;
  }

  public get speech(): handlers.Speech {
    if (!this._speech) {
      this._speech = new handlers.Speech(this as unknown as SuperAgent);
    }

    return this._speech;
  }

  public get image(): handlers.Image {
    if (!this._image) {
      this._image = new handlers.Image(this as unknown as SuperAgent);
    }

    return this._image;
  }
}
