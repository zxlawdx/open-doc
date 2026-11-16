from shared.services.workspace_renderer import workspace_view


def register_routes(router):
    router.add('/data', lambda params: workspace_view(params, 'data'), name='data', title='Dados', layout='blank', show_in_sidebar=False)
