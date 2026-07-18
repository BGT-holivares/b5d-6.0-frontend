import { Component, inject } from '@angular/core';
import { LoadingPanelService } from '../../services/loading-panel.service';
import { I18nService } from '../../utils/i18n/i18n.service';
import { GLOBAL_TRANSLATIONS } from '../../utils/i18n/global.translations';

@Component({
  selector: 'app-loading-panel',
  standalone: true,
  imports: [],
  templateUrl: './loading-panel.html',
  styleUrl: './loading-panel.scss',
})
export class LoadingPanel {
  readonly loadingPanel = inject(LoadingPanelService);
  readonly i18n = inject(I18nService);
  readonly globalTranslations = GLOBAL_TRANSLATIONS;

  get state() {
    return this.loadingPanel.state();
  }
}
