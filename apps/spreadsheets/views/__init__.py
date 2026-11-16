from shared.services.workspace_renderer import workspace_view


def register_routes(router):
    router.add('/spreadsheets', lambda params: workspace_view(params, 'spreadsheets'), name='spreadsheets', title='Planilhas', layout='blank', show_in_sidebar=False)
