from shared.services.workspace_renderer import workspace_view


def register_routes(router):
    router.add('/pdf', lambda params: workspace_view(params, 'pdf'), name='pdf', title='PDF', layout='blank', show_in_sidebar=False)
